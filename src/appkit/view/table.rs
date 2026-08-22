//! `Table`: a view-based `NSTableView` in a scroll view, fed a cell at a
//! time from the [`TableRows`] it holds.

use super::{Attr, Cx, Event, Prop, Rel, TableRows, Widget};
use crate::error::Result;
use crate::geometry::{Positive, Rect};
use crate::objc::appkit::{
    ColumnAutoresizingStyle, LineBreakMode, NSLayoutConstraint, NSScrollView, NSTableCellView,
    NSTableColumn, NSTableView, NSTextField, NSView,
};
use crate::objc::foundation::{NSMutableIndexSet, NSString};
use crate::objc::{self, NsStr, Object, sel};

/// `NSTableColumnAutoresizingMask | NSTableColumnUserResizingMask`.
const COLUMN_RESIZING: usize = 1 | 2;
const CELL_PADDING: f64 = 2.0;
/// A scroll view has no intrinsic size, so without this a table with no
/// explicit `height` collapses to nothing. It sits below the window's 240
/// bottom pin so a table still stretches to fill a window.
const FALLBACK_SIZE_PRIORITY: f32 = 200.0;
const FALLBACK_WIDTH: f64 = 240.0;
const FALLBACK_HEIGHT: f64 = 160.0;

/// The implicit single "value" column, or the caller's columns (never empty).
enum Columns {
    Implicit(NSTableColumn),
    Explicit(Vec<NSTableColumn>),
}

impl Columns {
    fn as_slice(&self) -> &[NSTableColumn] {
        match self {
            Columns::Implicit(c) => core::slice::from_ref(c),
            Columns::Explicit(v) => v,
        }
    }

    fn is_explicit(&self) -> bool {
        matches!(self, Columns::Explicit(_))
    }
}

pub(crate) struct Table {
    scroll: NSScrollView,
    table: NSTableView,
    /// Kept so the header can come back after `set_header_view(None)`.
    header: Option<NSView>,
    header_wanted: Option<bool>,
    columns: Columns,
    rows: Box<dyn TableRows>,
    /// What the caller asked to select; re-applied when rows or columns change
    /// so prop order does not matter.
    selected_wanted: Vec<usize>,
    default_row_height: f64,
    cell_id: NSString,
    empty: NSString,
}

impl Table {
    pub(crate) fn new(cx: &Cx<'_>) -> Table {
        let frame = Rect::new(0.0, 0.0, FALLBACK_WIDTH, FALLBACK_HEIGHT);
        let scroll = NSScrollView::init_with_frame(objc::alloc::<NSScrollView>(), frame);
        let table = NSTableView::init_with_frame(objc::alloc::<NSTableView>(), frame);
        table.set_uses_alternating_row_background_colors(false);
        table.set_allows_multiple_selection(false);
        table.set_allows_empty_selection(true);
        table.set_allows_column_reordering(false);
        table.set_column_autoresizing_style(ColumnAutoresizingStyle::LastColumnOnly);
        let header = table.header_view();

        scroll.set_has_vertical_scroller(true);
        scroll.set_has_horizontal_scroller(false);
        scroll.set_autohides_scrollers(true);
        let document: &NSView = &table;
        scroll.set_document_view(Some(document));
        for (attr, len) in [
            (Attr::Width, FALLBACK_WIDTH),
            (Attr::Height, FALLBACK_HEIGHT),
        ] {
            let c = NSLayoutConstraint::with_items(
                &scroll,
                attr,
                Rel::Equal,
                None,
                Attr::NotAnAttribute,
                1.0,
                len,
            );
            c.set_priority(FALLBACK_SIZE_PRIORITY);
            c.set_active(true);
        }

        table.set_data_source(Some(cx.target));
        table.set_delegate(Some(cx.target));
        table.set_target(Some(cx.target));
        table.set_double_action(Some(sel!("onDoubleAction:")));

        let columns = Columns::Implicit(make_column(
            &table,
            NsStr::Utf8("value"),
            NsStr::Utf8(""),
            None,
        ));
        let default_row_height = table.row_height();
        let me = Table {
            scroll,
            table,
            header,
            header_wanted: None,
            columns,
            rows: Box::new(NoRows),
            selected_wanted: Vec::new(),
            default_row_height,
            cell_id: NSString::from("BunAppKitTextCell"),
            empty: NSString::from(""),
        };
        me.sync_header();
        me
    }

    /// The header shows when asked for, or by default once real columns exist
    /// (the implicit single column has nothing to title).
    fn sync_header(&self) {
        let visible = self
            .header_wanted
            .unwrap_or_else(|| self.columns.is_explicit());
        self.table
            .set_header_view(if visible { self.header.as_ref() } else { None });
    }

    /// Selects the wanted rows that exist right now; at most one on a
    /// single-selection table, because AppKit only enforces that for clicks.
    /// Inside `set` the table's row-count question is refused, so there this
    /// selects against a stale count and only sticks once the setter's
    /// borrow ends and runs [`Widget::reload`].
    fn apply_selection(&self) {
        let in_range = self
            .selected_wanted
            .iter()
            .copied()
            .filter(|&i| i < self.rows.len());
        let live: Vec<usize> = if self.table.allows_multiple_selection() {
            in_range.collect()
        } else {
            in_range.min().into_iter().collect()
        };
        self.table
            .select_row_indexes(&NSMutableIndexSet::from_slice(&live), false);
    }

    fn selected(&self) -> Vec<usize> {
        self.table.selected_row_indexes().to_vec()
    }

    fn new_cell(&self) -> NSTableCellView {
        let cell =
            NSTableCellView::init_with_frame(objc::alloc::<NSTableCellView>(), Rect::default());
        let label = NSTextField::label(&self.empty);
        label.set_translates_autoresizing_mask(false);
        label.set_line_break_mode(LineBreakMode::ByTruncatingTail);
        cell.add_subview(&label);
        cell.set_text_field(Some(&label));
        cell.set_identifier(Some(&self.cell_id));
        for (attr, constant) in [
            (Attr::Leading, CELL_PADDING),
            (Attr::Trailing, -CELL_PADDING),
            (Attr::CenterY, 0.0),
        ] {
            NSLayoutConstraint::with_items(
                &label,
                attr,
                Rel::Equal,
                Some(&*cell),
                attr,
                1.0,
                constant,
            )
            .set_active(true);
        }
        cell
    }
}

/// A table's contents until `rows` is set.
struct NoRows;

impl TableRows for NoRows {
    fn len(&self) -> usize {
        0
    }
    fn cell(&self, _row: usize, _column: usize) -> Option<NsStr<'_>> {
        None
    }
}

/// Creates a column and adds it to `table`.
fn make_column(
    table: &NSTableView,
    id: NsStr<'_>,
    title: NsStr<'_>,
    width: Option<Positive>,
) -> NSTableColumn {
    let column = NSTableColumn::init_with_identifier(
        objc::alloc::<NSTableColumn>(),
        &NSString::from_str(id),
    );
    column.set_title(&NSString::from_str(title));
    column.set_editable(false);
    column.set_resizing_mask(COLUMN_RESIZING);
    if let Some(w) = width {
        column.set_width(w.get());
    }
    table.add_table_column(&column);
    column
}

impl Widget for Table {
    fn view(&self) -> &NSView {
        &self.scroll
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Columns(spec) => {
                for column in self.columns.as_slice() {
                    self.table.remove_table_column(column);
                }
                self.columns = if spec.is_empty() {
                    Columns::Implicit(make_column(
                        &self.table,
                        NsStr::Utf8("value"),
                        NsStr::Utf8(""),
                        None,
                    ))
                } else {
                    Columns::Explicit(
                        spec.iter()
                            .map(|c| make_column(&self.table, c.id, c.title, c.width))
                            .collect(),
                    )
                };
                self.sync_header();
                self.reload();
            }
            Prop::Rows(rows) => {
                self.rows = rows;
                self.reload();
            }
            Prop::SelectedIndexes(indexes) => {
                self.selected_wanted = indexes;
                self.apply_selection();
            }
            Prop::Multiple(b) => {
                self.table.set_allows_multiple_selection(b);
                if !b {
                    // AppKit trimmed the live selection to one row just now;
                    // trim the request to match so a later reload cannot
                    // bring the other rows back.
                    let keep = self
                        .selected()
                        .first()
                        .copied()
                        .or_else(|| self.selected_wanted.iter().copied().min());
                    self.selected_wanted = keep.into_iter().collect();
                }
                self.apply_selection();
            }
            Prop::HeaderVisible(b) => {
                self.header_wanted = b;
                self.sync_header();
            }
            Prop::AlternatingRows(b) => self.table.set_uses_alternating_row_background_colors(b),
            Prop::RowHeight(h) => self
                .table
                .set_row_height(h.map_or(self.default_row_height, Positive::get)),
            Prop::Enabled(b) => self.table.set_enabled(b),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn selected_indexes(&self) -> Option<Vec<usize>> {
        Some(self.selected())
    }

    fn table_rows(&self) -> usize {
        self.rows.len()
    }

    fn table_cell(
        &self,
        table: &NSTableView,
        column: Option<&NSTableColumn>,
        row: usize,
    ) -> Option<NSView> {
        let column = column?;
        let index = self.columns.as_slice().iter().position(|c| c == column)?;
        let cell = match table
            .make_view_with_identifier(&self.cell_id, None)
            .and_then(|v| v.downcast::<NSTableCellView>().ok())
        {
            Some(cell) => cell,
            None => self.new_cell(),
        };
        if let Some(label) = cell.text_field() {
            match self.rows.cell(row, index) {
                Some(text) => label.set_string_value(&NSString::from_str(text)),
                None => label.set_string_value(&self.empty),
            }
        }
        Some(NSView::clone(&cell))
    }

    fn on_selection(&mut self, emit: &mut dyn FnMut(Event)) {
        self.selected_wanted = self.selected();
        emit(Event::SelectionChanged(self.selected_wanted.clone()));
    }

    fn reload(&self) {
        self.table.reload_data();
        self.apply_selection();
    }

    fn on_double_action(&mut self, emit: &mut dyn FnMut(Event)) {
        if let Ok(row) = usize::try_from(self.table.clicked_row()) {
            emit(Event::RowActivated(row));
        }
    }

    fn detach(&mut self) {
        self.table.set_data_source(None);
        self.table.set_delegate(None);
        self.table.set_target(None);
        self.table.set_double_action(None);
    }
}
