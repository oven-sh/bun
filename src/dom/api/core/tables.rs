//! <https://html.spec.whatwg.org/#tables>

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsScope};

use super::*;
use crate::generated_bindgen::html::{
    HTMLTableCaptionElement, HTMLTableCellElement, HTMLTableElement, HTMLTableRowElement,
    HTMLTableSectionElement,
};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

fn children(parent: &Node, tag: Known) -> impl Iterator<Item = &Element> + Clone {
    parent.element_children().filter(move |it| it.is_html(tag))
}

fn rows_in(section: &Node) -> impl Iterator<Item = &Element> + Clone {
    children(section, atom!("tr"))
}

fn rows_of(table: &Node) -> impl Iterator<Item = &Element> + Clone {
    let of = move |tag| children(table, tag).flat_map(|it| rows_in(it));
    let body = table.element_children().flat_map(|it| {
        let rows = it.is_html(atom!("tbody")).then(|| rows_in(it));
        it.is_html(atom!("tr"))
            .then_some(it)
            .into_iter()
            .chain(rows.into_iter().flatten())
    });
    of(atom!("thead")).chain(body).chain(of(atom!("tfoot")))
}

fn rank(child: &Element) -> Option<u8> {
    match child.html_tag() {
        atom!("thead") => Some(0),
        atom!("tbody") | atom!("tr") => Some(1),
        atom!("tfoot") => Some(2),
        _ => None,
    }
}

fn is_in_its_place(table: &Node, moved: &Element) -> bool {
    let of = |it: &Node| rank(it.as_element()?);
    let own = rank(moved).filter(|_| moved.parent() == Some(table));
    own.is_none_or(|own| {
        moved
            .previous_siblings()
            .find_map(of)
            .is_none_or(|it| it <= own)
            && moved
                .next_siblings()
                .find_map(of)
                .is_none_or(|it| own <= it)
    })
}

fn has_rows_in_tree_order(table: &Node) -> bool {
    ![atom!("thead"), atom!("tfoot")]
        .into_iter()
        .any(|it| table.may_have_below(it))
        || table.element_children().filter_map(rank).is_sorted()
}

static ROWS: Test = Test {
    tags: &[atom!("tr")],
    matches: |it| it.kind() == Kind::TableRow,
    belongs: |table, row| table_of(row) == Some(table),
    lists: |table, add| {
        !has_rows_in_tree_order(table) && {
            add.into_iter().for_each(|add| rows_of(table).for_each(add));
            true
        }
    },
    allows_move: Some(is_in_its_place),
    ..Test::ALL
};

fn table_of(row: &Node) -> Option<&Node> {
    row.parent()
        .and_then(|it| {
            if it.kind() == Kind::TableSection {
                it.parent()
            } else {
                Some(it)
            }
        })
        .filter(|it| it.kind() == Kind::Table)
}

/// The rows of a table or a section, or the cells of a row.
fn parts_of<'a>(heap: &JsHeap<'a>, parent: &'a Node) -> &'a HTMLCollection {
    let filter = || match parent.kind() {
        Kind::Table => Filter::descendants(&ROWS),
        Kind::TableRow => Filter::Parts(|it| it.kind() == Kind::TableCell),
        _ => Filter::Parts(|it| it.kind() == Kind::TableRow),
    };
    HTMLCollection::from_value(parent.same_object(heap, Edge::Rows, || {
        HTMLCollection::new(heap, parent, filter()).to_js()
    }))
    .expect("made here")
}

fn index_in<'a>(heap: &JsHeap<'a>, parent: Option<&'a Node>, wanted: &Node) -> i32 {
    parent
        .and_then(|it| parts_of(heap, it).index_of(wanted))
        .map_or(-1, |it| it as i32)
}

#[cold]
fn out_of_range<'a>(heap: &JsHeap<'a>, index: i32) -> bindgen::Error<'a> {
    heap.dom_exception(
        DomError::IndexSizeError,
        format_args!("The index ({index}) is outside of the range."),
    )
}

/// What to insert before. `None` is the end.
fn insertion_point<'a>(
    heap: &JsHeap<'a>,
    parent: &'a Node,
    index: i32,
) -> Result<'a, Option<&'a Node>> {
    match index {
        -1 => Ok(None),
        0.. if index == 0 || parts_of(heap, parent).node(index as u32 - 1).is_some() => {
            Ok(parts_of(heap, parent).node(index as u32))
        }
        _ => Err(out_of_range(heap, index)),
    }
}

fn insert_new<'a>(
    cx: Cx<'_, 'a>,
    tag: Known,
    parent: &'a Node,
    before: Option<&'a Node>,
) -> &'a Element {
    let made = parent.doc().create_html(&cx.heap, tag);
    insert(cx, made, parent, before, Observers::Notify);
    made
}

fn last_part_of<'a>(heap: &JsHeap<'a>, parent: &'a Node) -> Option<&'a Node> {
    let all = parts_of(heap, parent);
    all.node(all.len().checked_sub(1)?)
}

fn delete_at<'a>(cx: Cx<'_, 'a>, parent: &'a Node, index: i32) -> Result<'a> {
    let found = match index {
        -1 => last_part_of(&cx.heap, parent),
        _ => Some(
            u32::try_from(index)
                .ok()
                .and_then(|it| parts_of(&cx.heap, parent).node(it))
                .ok_or_else(|| out_of_range(&cx.heap, index))?,
        ),
    };
    found
        .into_iter()
        .for_each(|it| remove(cx, it, Observers::Notify));
    Ok(())
}

impl HTMLTableElement {
    fn part(&self, tag: Known) -> Option<&Element> {
        children(self, tag).next()
    }

    fn place_for(&self, tag: Known) -> Option<&Node> {
        match tag {
            atom!("caption") => self.first_child(),
            atom!("thead") => self
                .element_children()
                .find(|it| !matches!(it.html_tag(), atom!("caption") | atom!("colgroup")))
                .map(|it| &**it),
            _ => None,
        }
    }

    fn create_part<'a>(&'a self, cx: Cx<'_, 'a>, tag: Known) -> &'a Element {
        self.part(tag)
            .unwrap_or_else(|| insert_new(cx, tag, self, self.place_for(tag)))
    }

    fn delete_part<'a>(&'a self, cx: Cx<'_, 'a>, tag: Known) {
        self.part(tag)
            .into_iter()
            .for_each(|it| remove(cx, it, Observers::Notify));
    }

    fn set_part<'a>(&'a self, cx: Cx<'_, 'a>, tag: Known, part: Option<&'a Element>) -> Result<'a> {
        if part.is_some_and(|it| !it.is_html(tag)) {
            return Err(cx.heap.dom_exception(
                DomError::HierarchyRequestError,
                format_args!("The value is not a '{}' element.", tag.as_str()),
            ));
        }
        self.delete_part(cx, tag);
        part.map_or(Ok(()), |it| pre_insert(cx, it, self, self.place_for(tag)))
    }

    pub(crate) fn get_tbodies<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_collection(
            heap,
            Edge::Parts,
            Filter::Parts(|it| it.is_html(atom!("tbody"))),
        )
    }

    pub(crate) fn create_tbody<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a Element {
        insert_new(
            cx,
            atom!("tbody"),
            self,
            children(self, atom!("tbody"))
                .last()
                .and_then(|it| it.next_sibling()),
        )
    }

    pub(crate) fn get_rows<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        parts_of(heap, self).to_js()
    }

    pub(crate) fn insert_row<'a>(&'a self, cx: Cx<'_, 'a>, index: i32) -> Result<'a, &'a Element> {
        let before = insertion_point(&cx.heap, self, index)?;
        let parent = before
            .or_else(|| last_part_of(&cx.heap, self))
            .and_then(|it| it.parent())
            .or_else(|| children(self, atom!("tbody")).last().map(|it| &**it));
        if let Some(parent) = parent {
            return Ok(insert_new(cx, atom!("tr"), parent, before));
        }
        let (body, row) = (
            self.doc().create_html(&cx.heap, atom!("tbody")),
            self.doc().create_html(&cx.heap, atom!("tr")),
        );
        append_detached(body, row);
        insert(cx, body, self, None, Observers::Notify);
        Ok(row)
    }

    pub(crate) fn delete_row<'a>(&'a self, cx: Cx<'_, 'a>, index: i32) -> Result<'a> {
        delete_at(cx, self, index)
    }
}

macro_rules! parts {
    ($($tag:tt $type:ty: $get:ident $set:ident $create:ident $delete:ident;)*) => {
        impl HTMLTableElement {
            $(pub(crate) fn $get(&self) -> Option<&Element> {
                self.part(atom!($tag))
            }

            pub(crate) fn $set<'a>(&'a self, cx: Cx<'_, 'a>, part: Option<&'a $type>) -> Result<'a> {
                self.set_part(cx, atom!($tag), part.map(|it| &***it))
            }

            pub(crate) fn $create<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a Element {
                self.create_part(cx, atom!($tag))
            }

            pub(crate) fn $delete<'a>(&'a self, cx: Cx<'_, 'a>) {
                self.delete_part(cx, atom!($tag));
            })*
        }
    };
}

parts! {
    "caption" HTMLTableCaptionElement: get_caption set_caption create_caption delete_caption;
    "thead" HTMLTableSectionElement: get_thead set_thead create_thead delete_thead;
    "tfoot" HTMLTableSectionElement: get_tfoot set_tfoot create_tfoot delete_tfoot;
}

impl HTMLTableSectionElement {
    pub(crate) fn get_rows<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        parts_of(heap, self).to_js()
    }

    pub(crate) fn insert_row<'a>(&'a self, cx: Cx<'_, 'a>, index: i32) -> Result<'a, &'a Element> {
        let before = insertion_point(&cx.heap, self, index)?;
        Ok(insert_new(cx, atom!("tr"), self, before))
    }

    pub(crate) fn delete_row<'a>(&'a self, cx: Cx<'_, 'a>, index: i32) -> Result<'a> {
        delete_at(cx, self, index)
    }
}

impl HTMLTableRowElement {
    pub(crate) fn get_row_index<'a>(&'a self, heap: &JsHeap<'a>) -> i32 {
        index_in(heap, table_of(self), self)
    }

    pub(crate) fn get_section_row_index<'a>(&'a self, heap: &JsHeap<'a>) -> i32 {
        index_in(
            heap,
            self.parent()
                .filter(|it| matches!(it.kind(), Kind::Table | Kind::TableSection)),
            self,
        )
    }

    pub(crate) fn get_cells<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        parts_of(heap, self).to_js()
    }

    pub(crate) fn insert_cell<'a>(&'a self, cx: Cx<'_, 'a>, index: i32) -> Result<'a, &'a Element> {
        let before = insertion_point(&cx.heap, self, index)?;
        Ok(insert_new(cx, atom!("td"), self, before))
    }

    pub(crate) fn delete_cell<'a>(&'a self, cx: Cx<'_, 'a>, index: i32) -> Result<'a> {
        delete_at(cx, self, index)
    }
}

impl HTMLTableCellElement {
    pub(crate) fn get_cell_index(&self) -> i32 {
        let before = || {
            self.previous_siblings()
                .filter(|it| it.kind() == Kind::TableCell)
                .count() as i32
        };
        if self.parent().is_some_and(|it| it.kind() == Kind::TableRow) {
            before()
        } else {
            -1
        }
    }
}
