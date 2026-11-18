//! Table layout.

use core::cmp::Ordering;
use core::ops::Range;
use std::rc::Rc;

use crate::abi::Rect;
use crate::boxes::{BoxId, Kind, LayoutBox};
use crate::document::Document;
use crate::fragment::{Band, Breaks, Flow, Member};
use crate::layout::{AutoSize, Edges, Input, Layout, Output, Room, Widths, clamp, margin, unit};
use crate::name::name;
use crate::order::Order as _;
use crate::properties::Style;
use crate::scroll::Contents;
use crate::types::*;
use crate::values::{Lp, Size};

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Edge {
    pub(crate) width: f32,
    pub(crate) style: BorderStyle,
    pub(crate) color: u32,
}

/// The borders that have won, with `border-collapse: collapse`: top, right, bottom and left.
pub(crate) type Collapsed = [Edge; 4];

/// The collapsed borders of a table, piece by piece.
#[derive(PartialEq)]
pub(crate) struct Lattice {
    rows: Vec<BoxId>,
    /// Where the columns start and end in a row.
    lines: Vec<f32>,
    /// With the rank of the box that they are from.
    horizontal: Vec<(Edge, u32)>,
    vertical: Vec<(Edge, u32)>,
}

impl Lattice {
    /// The size of the crossing, and which of the four pieces (before, after, over, under) reach across it.
    fn joint(&self, row: usize, column: usize) -> ([f32; 2], [bool; 4]) {
        let columns = self.lines.len() - 1;
        let shown = |it: Option<&(Edge, u32)>| {
            it.copied()
                .filter(|it| !it.0.style.is_none() && it.0.width > 0.0)
        };
        let across = |column: Option<usize>| {
            shown(
                self.horizontal
                    .get(row * columns + column.filter(|it| *it < columns)?),
            )
        };
        let down = |row: Option<usize>| shown(self.vertical.get(row? * (columns + 1) + column));
        let compare = |a: Option<(Edge, u32)>, b: Option<(Edge, u32)>| {
            let rank = |it: Option<(Edge, u32)>| {
                it.map(|(edge, order)| (edge.width, precedence(edge.style), u32::MAX - order))
            };
            rank(a).partial_cmp(&rank(b)).unwrap_or(Ordering::Equal)
        };
        let ([before, after], [over, under]) = (
            [across(column.checked_sub(1)), across(Some(column))],
            [down(row.checked_sub(1)), down(Some(row))],
        );
        let (inline, block) = (compare(before, after), compare(over, under));
        let (across, down) = (
            if inline.is_gt() { before } else { after },
            if block.is_gt() { over } else { under },
        );
        let both = compare(across, down);
        let wins = [
            both.is_ge() && inline.is_ge(),
            both.is_ge() && inline.is_le(),
            both.is_le() && block.is_ge(),
            both.is_le() && block.is_le(),
        ];
        (
            [down, across].map(|it| it.map_or(0.0, |it| it.0.width)),
            wins,
        )
    }

    /// `row_rect` tells where a row is. The flag is set for a horizontal piece.
    pub(crate) fn pieces(
        &self,
        row_rect: impl Fn(BoxId) -> Rect,
        visible: Rect,
        mut visit: impl FnMut(Rect, Edge, bool),
    ) {
        let (columns, Some(last)) = (self.lines.len() - 1, self.rows.last()) else {
            return;
        };
        let reach = |size: f32, wins: bool| if wins { size / 2.0 } else { -size / 2.0 };
        for row in 0..=self.rows.len() {
            let rect = self
                .rows
                .get(row)
                .map_or_else(|| row_rect(*last), |it| row_rect(*it));
            let top = if row < self.rows.len() {
                rect.y
            } else {
                rect.bottom()
            };
            if !rect.grown(1024.0).touches(&visible) {
                continue;
            }
            for column in 0..=columns {
                let (x, (size, wins)) = (rect.x + self.lines[column], self.joint(row, column));
                if let Some((edge, _)) = self.vertical.get(row * (columns + 1) + column) {
                    let (end_size, end_wins) = self.joint(row + 1, column);
                    let [from, to] = [
                        top - reach(size[1], wins[3]),
                        rect.bottom() + reach(end_size[1], end_wins[2]),
                    ];
                    visit(
                        Rect::from_edges(x - edge.width / 2.0, from, x + edge.width / 2.0, to),
                        *edge,
                        false,
                    );
                }
                if let Some((edge, _)) = self
                    .horizontal
                    .get(row * columns + column)
                    .filter(|_| column < columns)
                {
                    let ((end_size, end_wins), end) =
                        (self.joint(row, column + 1), rect.x + self.lines[column + 1]);
                    let [near, far] = [reach(size[0], wins[1]), reach(end_size[0], end_wins[0])];
                    let [from, to] = if self.lines[0] <= self.lines[columns] {
                        [x - near, end + far]
                    } else {
                        [end - far, x + near]
                    };
                    visit(
                        Rect::from_edges(from, top - edge.width / 2.0, to, top + edge.width / 2.0),
                        *edge,
                        true,
                    );
                }
            }
        }
    }
}

fn edges(style: &Style) -> Collapsed {
    let (l, p, widths) = (&style.layout, &style.paint, style.border());
    let styles = [
        l.border_top_style,
        l.border_right_style,
        l.border_bottom_style,
        l.border_left_style,
    ];
    let colors = [p.border_top, p.border_right, p.border_bottom, p.border_left];
    [0, 1, 2, 3].map(|side| Edge {
        width: widths[side],
        style: styles[side],
        color: colors[side].resolve(style.color()),
    })
}

fn precedence(style: BorderStyle) -> u8 {
    match style {
        BorderStyle::None | BorderStyle::Hidden => 0,
        BorderStyle::Inset => 1,
        BorderStyle::Groove => 2,
        BorderStyle::Outset => 3,
        BorderStyle::Ridge => 4,
        BorderStyle::Dotted => 5,
        BorderStyle::Dashed => 6,
        BorderStyle::Solid => 7,
        BorderStyle::Double => 8,
    }
}

#[inline(always)]
fn beats(a: Edge, b: Edge) -> bool {
    // The bits of positive numbers are in the order of the numbers.
    let rank = |it: Edge| {
        u64::from(it.style == BorderStyle::Hidden) << 40
            | u64::from((it.width + 0.0).to_bits()) << 8
            | u64::from(precedence(it.style))
    };
    rank(a) > rank(b)
}

/// Of two that are equal, the first.
fn winner(a: Edge, b: Edge) -> Edge {
    if beats(b, a) { b } else { a }
}

struct Cell {
    id: BoxId,
    row: usize,
    column: usize,
    rows: usize,
    columns: usize,
    /// The same as that of the cell before if the styles are the same.
    look: u32,
    /// In pixels, or as a fraction.
    height: (Option<f32>, Option<f32>),
    /// To the baseline of the row.
    is_aligned: bool,
}

#[derive(Clone, Copy, Default)]
struct Column {
    min: f32,
    max: f32,
    is_fixed: bool,
    fraction: Option<f32>,
    /// No cell starts in it, and nothing gives it a width.
    is_merged: bool,
    is_collapsed: bool,
}

/// What was found when the parts of tables were in that version.
pub(crate) struct Prepared {
    version: u32,
    grid: Rc<Grid>,
    /// Before the cells are measured.
    columns: Vec<Column>,
}

#[derive(Default)]
struct Grid {
    captions: Vec<BoxId>,
    groups: Vec<BoxId>,
    /// The row, and its group.
    rows: Vec<(BoxId, BoxId)>,
    cells: Vec<Cell>,
    columns: Vec<Column>,
    /// The column boxes and their groups, with the columns that they span.
    column_boxes: Vec<(BoxId, usize, usize)>,
}

impl Grid {
    fn is_empty(&self) -> bool {
        self.columns.iter().all(|it| it.is_merged)
    }
}

impl Column {
    fn encompass(&mut self, other: &Column) {
        self.min = self.min.max(other.min);
        self.max = match (self.is_fixed, other.is_fixed) {
            (true, false) => self.max.max(other.min),
            (false, true) => other.max,
            _ => self.max.max(other.max),
        };
        self.max = self.max.max(self.min);
        self.is_fixed |= other.is_fixed;
        self.fraction = self
            .fraction
            .into_iter()
            .chain(other.fraction)
            .reduce(f32::max);
    }
}

fn snapped(mut sizes: Vec<f32>, total: f32) -> Vec<f32> {
    sizes.iter_mut().for_each(|it| *it = unit(*it));
    let missing = total - sizes.iter().sum::<f32>();
    if let Some(last) = sizes
        .iter_mut()
        .rfind(|it| **it > 0.0)
        .filter(|_| missing.abs() < 1.0)
    {
        *last += missing;
    }
    sizes
}

/// That spans can make.
const MAX_COLUMNS: usize = 4096;

fn distribute_fixed(columns: &[Column], width: f32) -> Vec<f32> {
    let is_auto = |it: &Column| !it.is_fixed && it.fraction.is_none();
    let fixed: f32 = columns
        .iter()
        .filter(|it| it.fraction.is_none() && it.is_fixed)
        .map(|it| it.max)
        .sum();
    let relative: f32 = columns
        .iter()
        .filter_map(|it| Some(it.fraction? * width + it.max))
        .sum();
    let automatic = columns.iter().filter(|it| is_auto(it)).count();
    let fixed_scale =
        match fixed > 0.0 && (automatic == 0 && fixed + relative < width || fixed > width) {
            true if fixed > width => width / fixed,
            true => (width - relative) / fixed,
            false => 1.0,
        };
    let left = (width - fixed * fixed_scale).max(0.0);
    let relative_scale = if relative > 0.0 && (automatic == 0 || relative > left) {
        left / relative
    } else {
        1.0
    };
    let share = (left - relative * relative_scale)
        / if automatic > 0 {
            automatic
        } else {
            columns.len()
        } as f32;
    let size = |it: &Column| match it.fraction {
        Some(fraction) => (fraction * width + it.max) * relative_scale,
        None if it.is_fixed && (automatic > 0 || fixed > 0.0) => it.max * fixed_scale,
        None => share,
    };
    columns.iter().map(size).collect()
}

fn distribute(columns: &[Column], width: f32) -> Vec<f32> {
    let guesses: [&dyn Fn(&Column) -> f32; 4] = [
        &|it| it.min,
        &|it| {
            it.fraction
                .map_or(it.min, |fraction| (fraction * width).max(it.min))
        },
        &|it| {
            it.fraction
                .map_or(if it.is_fixed { it.max } else { it.min }, |fraction| {
                    (fraction * width).max(it.min)
                })
        },
        &|it| {
            it.fraction
                .map_or(it.max, |fraction| (fraction * width).max(it.min))
        },
    ];
    let sums = guesses.map(|guess| columns.iter().map(guess).sum::<f32>());
    if let Some(upper) = sums.iter().position(|sum| *sum >= width) {
        let lower = upper.saturating_sub(1);
        let t = if sums[upper] > sums[lower] {
            (width - sums[lower]) / (sums[upper] - sums[lower])
        } else {
            0.0
        };
        return columns
            .iter()
            .map(|it| crate::values::mix(guesses[lower](it), guesses[upper](it), t))
            .collect();
    }
    let is_auto = |it: &Column| !it.is_fixed && it.fraction.is_none() && !it.is_merged;
    let weights: [&dyn Fn(&Column) -> f32; 6] = [
        &|it| if is_auto(it) { it.max } else { 0.0 },
        &|it| f32::from(is_auto(it)),
        &|it| if it.fraction.is_none() { it.max } else { 0.0 },
        &|it| it.fraction.unwrap_or(0.0),
        &|it| f32::from(!it.is_merged),
        &|_| 1.0,
    ];
    let total = |weight: &dyn Fn(&Column) -> f32| columns.iter().map(weight).sum::<f32>();
    let weight = weights
        .into_iter()
        .find(|weight| total(*weight) > 0.0)
        .unwrap_or(weights[5]);
    let excess = (width - sums[3]) / total(weight);
    columns
        .iter()
        .map(|it| guesses[3](it) + excess * weight(it))
        .collect()
}

impl Document {
    fn span(&self, id: BoxId, attribute: crate::name::Name) -> Option<usize> {
        let span = self.tree.element(self.boxes[id].node)?.number(attribute)?;
        Some(span.clamp(0.0, 1000.0) as usize)
    }

    fn table_grid(&self, id: BoxId) -> Grid {
        let mut grid = Grid::default();
        let display = |id: &BoxId| self.boxes[*id].style.display();
        let in_flow = |id: BoxId| self.boxes[id].children.iter().copied();
        for child in in_flow(id) {
            match self.boxes[child].kind {
                Kind::RowGroup => grid.groups.push(child),
                Kind::Column => {
                    let (children, first) = (&self.boxes[child].children, grid.columns.len());
                    for column in children.iter().chain(children.is_empty().then_some(&child)) {
                        let (mut new, l) = (Column::default(), &self.boxes[*column].style.layout);
                        let width = if l.width == Size::Auto {
                            &self.boxes[child].style.layout.width
                        } else {
                            &l.width
                        };
                        let [min, max] = [&l.min_width, &l.max_width.0].map(|it| {
                            if let Size::Length(Lp::Px(px)) = it {
                                Some(unit(*px))
                            } else {
                                None
                            }
                        });
                        new.min = min.unwrap_or(0.0);
                        match width {
                            Size::Length(Lp::Fraction(fraction)) if *fraction > 0.0 => {
                                new.fraction = Some(*fraction)
                            }
                            Size::Length(Lp::Px(px)) => {
                                (new.max, new.is_fixed) = (
                                    unit(*px).min(max.unwrap_or(f32::INFINITY)).max(new.min),
                                    true,
                                )
                            }
                            _ => {}
                        }
                        new.is_collapsed =
                            self.boxes[*column].style.ink.visibility.0 == Visibility::Collapse;
                        new.is_merged = new.fraction.is_none() && new.max == 0.0;
                        let span = self
                            .span(*column, name!("span"))
                            .unwrap_or(1)
                            .clamp(1, MAX_COLUMNS.saturating_sub(grid.columns.len()).max(1));
                        grid.column_boxes.push((
                            *column,
                            grid.columns.len(),
                            grid.columns.len() + span,
                        ));
                        grid.columns.extend(core::iter::repeat_n(new, span));
                    }
                    if !children.is_empty() {
                        grid.column_boxes.push((child, first, grid.columns.len()));
                    }
                }
                _ => grid.captions.push(child),
            }
        }
        if let Some(header) = grid
            .groups
            .iter()
            .position(|it| display(it) == Display::TableHeaderGroup)
        {
            grid.groups[..=header].rotate_right(1);
        }
        if let Some(footer) = grid
            .groups
            .iter()
            .position(|it| display(it) == Display::TableFooterGroup)
        {
            grid.groups[footer..].rotate_left(1);
        }
        let (mut occupied_until, mut last) =
            (Vec::<usize>::new(), None::<(&Rc<Style>, u32, _, bool)>);
        grid.cells.reserve(
            grid.groups
                .iter()
                .flat_map(|it| in_flow(*it))
                .map(|it| in_flow(it).len())
                .sum(),
        );
        for group in &grid.groups {
            let end = grid.rows.len() + in_flow(*group).len();
            for row in in_flow(*group) {
                let (index, mut column) = (grid.rows.len(), 0);
                grid.rows.push((row, *group));
                for cell in in_flow(row) {
                    while occupied_until
                        .get(column)
                        .is_some_and(|until| *until > index)
                    {
                        column += 1;
                    }
                    self.boxes.prefetch_start_after(cell);
                    let it = &self.boxes[cell];
                    let (mut columns, mut rows) = (1, 1);
                    if it.may_span {
                        columns = self
                            .span(
                                cell,
                                if it.tag == crate::name::Name::NONE {
                                    name!("columnspan")
                                } else {
                                    name!("colspan")
                                },
                            )
                            .unwrap_or(1)
                            .clamp(1, MAX_COLUMNS.saturating_sub(column).max(1));
                        rows = match self.span(cell, name!("rowspan")).unwrap_or(1) {
                            0 => end - index,
                            rows => rows.min(end - index),
                        };
                    }
                    if occupied_until.len() < column + columns {
                        occupied_until.resize(column + columns, 0);
                    }
                    if columns > 1 || rows > 1 {
                        occupied_until[column..column + columns].fill(index + rows);
                    }
                    let (_, look, height, is_aligned) = last
                        .filter(|last| Rc::ptr_eq(last.0, &it.style))
                        .unwrap_or_else(|| {
                            let is_aligned = match it.style.layout.align_content.0 {
                                _ if it.is_orthogonal() => false,
                                AlignName::Normal => !matches!(
                                    it.style.layout.vertical_align,
                                    VerticalAlign::Keyword(
                                        VerticalAlignName::Top
                                            | VerticalAlignName::Middle
                                            | VerticalAlignName::Bottom
                                    )
                                ),
                                other => other == AlignName::Baseline,
                            };
                            *last.insert((
                                &it.style,
                                grid.cells.len() as u32,
                                specified_height(it),
                                is_aligned,
                            ))
                        });
                    grid.cells.push(Cell {
                        id: cell,
                        row: index,
                        column,
                        rows,
                        columns,
                        look,
                        height,
                        is_aligned,
                    });
                    column += columns;
                }
            }
        }
        grid.columns.resize(
            grid.columns.len().max(occupied_until.len()),
            Column {
                is_merged: true,
                ..Column::default()
            },
        );
        grid.cells
            .iter()
            .for_each(|cell| grid.columns[cell.column].is_merged = false);
        grid
    }

    fn set_collapsed(&mut self, id: BoxId, collapsed: Option<&Rc<Collapsed>>) {
        let it = &mut self.boxes[id];
        if !it
            .collapsed
            .as_ref()
            .zip(collapsed)
            .is_some_and(|it| Rc::ptr_eq(it.0, it.1))
            && it.collapsed.as_ref() != collapsed
        {
            it.collapsed = collapsed.cloned();
            it.cache.clear();
        }
    }

    fn collapse_borders(&mut self, id: BoxId, grid: &Grid) {
        let of = |id: BoxId| edges(&self.boxes[id].style);
        let (rows, columns, table) = (grid.rows.len(), grid.columns.len(), of(id));
        let (start, end) = if self.boxes[id].style.is_rtl() {
            (1, 3)
        } else {
            (3, 1)
        };
        let none = Edge {
            width: 0.0,
            style: BorderStyle::None,
            color: 0,
        };
        let mut horizontal = vec![(none, 0); (rows + 1) * columns];
        let mut vertical = vec![(none, 0); rows * (columns + 1)];
        const COVERED: u32 = u32::MAX;
        let mut order = 0;
        let mut add =
            |edges: Collapsed, row: usize, row_end: usize, column: usize, column_end: usize| {
                order += 1;
                let merge = |known: &mut (Edge, u32), new: Edge| {
                    *known = if known.1 != COVERED && beats(new, known.0) {
                        (new, order)
                    } else {
                        *known
                    }
                };
                if row_end - row == 1 && column_end - column == 1 {
                    let ([above, before], merge) = (
                        [row * columns + column, row * (columns + 1) + column],
                        |known: &mut (Edge, u32), new: Edge| {
                            if new.style != BorderStyle::None {
                                merge(known, new)
                            }
                        },
                    );
                    merge(&mut horizontal[above], edges[0]);
                    merge(&mut horizontal[above + columns], edges[2]);
                    merge(&mut vertical[before], edges[start]);
                    return merge(&mut vertical[before + 1], edges[end]);
                }
                for at in (row..row_end).filter(|_| {
                    order as usize <= grid.cells.len() && row_end - row + column_end - column > 2
                }) {
                    let down =
                        &mut vertical[at * (columns + 1) + column + 1..][..column_end - column - 1];
                    let across = &mut horizontal[at * columns + column..]
                        [..if at > row { column_end - column } else { 0 }];
                    down.iter_mut()
                        .chain(across)
                        .filter(|it| it.1 == 0)
                        .for_each(|it| it.1 = COVERED);
                }
                for (line, side) in [(row, 0), (row_end, 2)]
                    .into_iter()
                    .filter(|it| edges[it.1].style != BorderStyle::None)
                {
                    horizontal[line * columns..][column..column_end]
                        .iter_mut()
                        .for_each(|it| merge(it, edges[side]));
                }
                for (line, side) in [(column, start), (column_end, end)]
                    .into_iter()
                    .filter(|it| edges[it.1].style != BorderStyle::None)
                {
                    (row..row_end).for_each(|at| {
                        merge(&mut vertical[at * (columns + 1) + line], edges[side])
                    });
                }
            };
        let mut last = (u32::MAX, table);
        for cell in &grid.cells {
            if cell.look != last.0 {
                last = (cell.look, of(cell.id));
            }
            add(
                last.1,
                cell.row,
                cell.row + cell.rows,
                cell.column,
                cell.column + cell.columns,
            );
        }
        for (index, (row, _)) in grid.rows.iter().enumerate() {
            add(of(*row), index, index + 1, 0, columns);
        }
        let mut first = 0;
        for group in grid.rows.chunk_by(|a, b| a.1 == b.1) {
            add(of(group[0].1), first, first + group.len(), 0, columns);
            first += group.len();
        }
        for (column, first, end) in &grid.column_boxes {
            add(of(*column), 0, rows, *first, *end);
        }
        add(table, 0, rows, 0, columns);
        let visible = |edge: Edge| if edge.style.is_none() { none } else { edge };
        let around = |row: usize, row_end: usize, column: usize, column_end: usize| {
            if row_end - row == 1 && column_end - column == 1 {
                let [above, before] = [row * columns + column, row * (columns + 1) + column];
                let mut edges = [
                    visible(horizontal[above].0),
                    none,
                    visible(horizontal[above + columns].0),
                    none,
                ];
                (edges[start], edges[end]) =
                    (visible(vertical[before].0), visible(vertical[before + 1].0));
                return edges;
            }
            let across = |line: usize| {
                horizontal[line * columns..][column..column_end]
                    .iter()
                    .map(|it| visible(it.0))
                    .reduce(winner)
                    .unwrap_or(none)
            };
            let down = |line: usize| {
                (row..row_end)
                    .map(|at| visible(vertical[at * (columns + 1) + line].0))
                    .reduce(winner)
                    .unwrap_or(none)
            };
            let mut edges = [across(row), none, across(row_end), none];
            (edges[start], edges[end]) = (down(column), down(column_end));
            edges
        };
        let is_full = grid.cells.len() == rows * columns
            && grid.cells.iter().all(|it| it.rows == 1 && it.columns == 1);
        let mut is_taken = vec![is_full; rows * columns];
        for cell in grid.cells.iter().filter(|_| !is_full) {
            (cell.row..cell.row + cell.rows)
                .for_each(|row| is_taken[row * columns + cell.column..][..cell.columns].fill(true));
        }
        let mut recent = [(); 2].map(|()| Rc::new([none; 4]));
        for cell in &grid.cells {
            let mut edges = around(
                cell.row,
                cell.row + cell.rows,
                cell.column,
                cell.column + cell.columns,
            );
            let above = cell.row > 0
                && (0..cell.columns)
                    .all(|it| is_taken[(cell.row - 1) * columns + cell.column + it]);
            let before = cell.column > 0
                && (0..cell.rows).all(|it| is_taken[(cell.row + it) * columns + cell.column - 1]);
            // What can be seen through is painted by one of the two cells.
            for (side, _) in [(0, above), (start, before)].into_iter().filter(|it| it.1) {
                edges[side].color *= u32::from(edges[side].color & 0xff == 0xff);
            }
            if *recent[0] != edges {
                recent.swap(0, 1);
                if *recent[0] != edges {
                    recent[0] = Rc::new(edges);
                }
            }
            self.set_collapsed(cell.id, Some(&recent[0]));
        }
        self.boxes[id].collapsed = Some(Rc::new(if rows == 0 || columns == 0 {
            [none; 4]
        } else {
            around(0, rows, 0, columns)
        }));
        let lines = self
            .boxes
            .lattices
            .get(&id)
            .map_or(Vec::new(), |it| it.lines.clone());
        let lattice = Lattice {
            rows: grid.rows.iter().map(|it| it.0).collect(),
            lines,
            horizontal,
            vertical,
        };
        if self.boxes.lattices.get(&id) != Some(&lattice) {
            self.boxes.lattices.insert(id, lattice);
            self.boxes.mark_ink(id);
        }
    }

    fn measure_columns(&mut self, grid: &mut Grid, spacing: f32, is_fixed: bool) {
        let counted = || {
            grid.cells
                .iter()
                .take_while(|cell| !is_fixed || cell.row == 0)
        };
        let mut spanning: Vec<&Cell> = counted().filter(|cell| cell.columns > 1).collect();
        spanning.order_by_key(|cell| cell.columns);
        let mut last = None;
        for cell in counted().filter(|cell| cell.columns == 1).chain(spanning) {
            self.boxes.prefetch_after(cell.id);
            let it = &self.boxes[cell.id];
            let (l, look) = (
                &it.style.layout,
                (cell.look, it.collapsed.as_ref().map(Rc::as_ptr)),
            );
            let (_, edges, [width, min, max], mut own) = last
                .filter(|it: &(_, _, _, _)| it.0 == look)
                .unwrap_or_else(|| {
                    let edges = it.border_and_padding(0.0).sums();
                    let fixed = |size: &Size| match size {
                        Size::Length(Lp::Px(_)) => {
                            it.resolve_size(size, 0, &Room::default(), edges, &mut |_| None)
                        }
                        _ => None,
                    };
                    let fraction = match (&l.width, &l.max_width.0) {
                        (Size::Length(Lp::Fraction(fraction)), Size::Length(Lp::Fraction(max))) => {
                            Some(fraction.min(*max))
                        }
                        (Size::Length(Lp::Fraction(fraction)), _) => Some(*fraction),
                        _ => None,
                    };
                    let sizes = [&l.width, &l.min_width, &l.max_width.0].map(fixed);
                    *last.insert((
                        look,
                        edges,
                        sizes,
                        Column {
                            fraction,
                            is_fixed: sizes[0].is_some(),
                            ..Column::default()
                        },
                    ))
                });
            let spanned = &mut grid.columns[cell.column..cell.column + cell.columns];
            let (between, count) = (
                spacing * spanned[1..].iter().filter(|it| !it.is_merged).count() as f32,
                cell.columns as f32,
            );
            if is_fixed {
                let outside = if own.fraction.is_some()
                    && l.box_sizing == BoxSizing::ContentBox
                    && count == 1.0
                {
                    edges[0]
                } else {
                    0.0
                };
                for column in spanned
                    .iter_mut()
                    .filter(|it| !it.is_fixed && it.fraction.is_none())
                {
                    column.max =
                        width.map_or(outside, |it| unit(((it - between) / count).max(0.0)));
                    (column.is_fixed, column.fraction) =
                        (own.is_fixed, own.fraction.map(|it| it / count));
                }
                continue;
            }
            let content = self.intrinsic_widths(cell.id, None).sizes;
            let limit = max.unwrap_or(f32::INFINITY).max(min.unwrap_or(0.0));
            own.min = content[0].max(min.unwrap_or(0.0)).min(limit);
            own.max = width.unwrap_or(content[1]).min(limit).max(own.min);
            if let [column] = spanned {
                column.encompass(&own);
                continue;
            }
            if let Some(surplus) = own
                .fraction
                .map(|it| it - spanned.iter().filter_map(|it| it.fraction).sum::<f32>())
                .filter(|it| *it > 0.0)
            {
                let others = || {
                    spanned
                        .iter()
                        .filter(|it| it.fraction.is_none() && !it.is_merged)
                };
                let (max, count) = (
                    others().map(|it| it.max).sum::<f32>(),
                    others().count() as f32,
                );
                for column in spanned
                    .iter_mut()
                    .filter(|it| it.fraction.is_none() && !it.is_merged)
                {
                    column.fraction = Some(
                        surplus
                            * if max > 0.0 {
                                column.max / max
                            } else {
                                1.0 / count
                            },
                    );
                }
            }
            let mins = distribute(spanned, (own.min - between).max(0.0));
            spanned
                .iter_mut()
                .zip(mins)
                .for_each(|(it, min)| (it.min, it.max) = (it.min.max(min), it.max.max(min)));
            let maxes = distribute(spanned, (own.max - between).max(0.0));
            for (it, max) in spanned
                .iter_mut()
                .zip(maxes)
                .filter(|it| own.is_fixed || !it.0.is_fixed)
            {
                it.max = it.max.max(max);
            }
        }
        let mut left = 1.0f32;
        for fraction in grid
            .columns
            .iter_mut()
            .filter(|_| !is_fixed)
            .filter_map(|it| it.fraction.as_mut())
        {
            *fraction = fraction.min(left);
            left -= *fraction;
        }
    }

    /// Also returns `border-spacing`, and whether the layout is fixed.
    fn prepare_table(&mut self, id: BoxId) -> (Rc<Grid>, [f32; 2], bool) {
        let (style, version) = (
            Rc::clone(&self.boxes[id].style),
            self.boxes.table_parts_version,
        );
        let collapses = style.text.border_collapse == BorderCollapse::Collapse;
        let spacing = if collapses {
            [0.0; 2]
        } else {
            [style.text.spacing_x.0, style.text.spacing_y.0].map(f32::floor)
        };
        let is_fixed = style.rare.table_layout == TableLayout::Fixed
            && !matches!(style.layout.width, Size::Auto | Size::MaxContent);
        if let Some(known) = self
            .boxes
            .tables
            .get(&id)
            .filter(|it| it.version == version && self.boxes[id].cache.has_widths())
        {
            return (Rc::clone(&known.grid), spacing, is_fixed);
        }
        let known = self
            .boxes
            .tables
            .remove(&id)
            .filter(|it| it.version == version);
        let mut grid = match known.and_then(|it| {
            Some(Grid {
                columns: it.columns,
                ..Rc::into_inner(it.grid)?
            })
        }) {
            Some(known) => known,
            None => {
                let mut grid = self.table_grid(id);
                if collapses {
                    self.collapse_borders(id, &grid);
                } else {
                    self.boxes[id].collapsed = None;
                    self.boxes.lattices.remove(&id);
                    grid.cells
                        .iter()
                        .for_each(|cell| self.set_collapsed(cell.id, None));
                }
                grid.columns
                    .iter_mut()
                    .for_each(|it| it.is_merged &= !is_fixed);
                grid
            }
        };
        let columns = grid.columns.clone();
        self.measure_columns(&mut grid, spacing[0], is_fixed);
        let (grid, it) = (Rc::new(grid), &self.boxes[id]);
        if [it.mode, it.turned] == [WritingMode::HorizontalTb; 2] && !it.is_parking {
            self.boxes.tables.insert(
                id,
                Prepared {
                    version,
                    grid: Rc::clone(&grid),
                    columns,
                },
            );
        }
        (grid, spacing, is_fixed)
    }

    pub(crate) fn table_min_width(&mut self, id: BoxId) -> f32 {
        self.intrinsic_widths(id, None).sizes[0]
    }

    pub(crate) fn table_width(&mut self, id: BoxId, room: &Room, auto: AutoSize) -> f32 {
        let [min, mut max] = self.intrinsic_widths(id, None).sizes;
        if self.boxes[id].ignores_column_percentages {
            max = self.table_widths(id, true).sizes[1];
        }
        let it = &self.boxes[id];
        let edges = it.border_and_padding(room.basis[0].unwrap_or(0.0)).sums();
        let [min, max] =
            [min, max].map(|size| size + edges[0] - it.border_and_padding(0.0).sums()[0]);
        if max == edges[0] + 2.0 * it.style.text.spacing_x.0.floor()
            && (&it.style.layout.width, &it.style.layout.min_width) == (&Size::Auto, &Size::Auto)
            && auto != AutoSize::Stretch
            && it.ratio.is_none()
        {
            let grid = self.prepare_table(id).0;
            if grid.is_empty() {
                return grid
                    .captions
                    .iter()
                    .map(|it| self.contribution(*it, None, None).sizes[0])
                    .fold(edges[0], f32::max);
            }
        }
        let it = &self.boxes[id];
        let height = room
            .height
            .or_else(|| it.styled_height(room, edges, None, None));
        let mut content = |size: &Size| match (size, room.available[0]) {
            (Size::MinContent, _) => Some(min),
            (Size::Auto, Some(available)) if auto == AutoSize::Stretch => Some(available),
            (Size::Auto, _)
                if let Some(width) = height.and_then(|height| it.transfer(0, height, edges)) =>
            {
                Some(width)
            }
            (Size::Auto | Size::FitContent, Some(available)) => Some(max.min(available)),
            _ => Some(max),
        };
        let width = it
            .resolve_size(&it.style.layout.width, 0, room, edges, &mut content)
            .unwrap_or(max);
        clamp(width, self.width_limits(id, room, edges)).max(min)
    }

    pub(crate) fn height_of_captions(&mut self, id: BoxId, width: f32) -> f32 {
        let grid = self.prepare_table(id).0;
        let height = |caption: BoxId| {
            let margins = margin(&self.boxes[caption].style, width).sums();
            let room = Room {
                available: [Some(width - margins[0]), None],
                basis: [Some(width), None],
                height: None,
            };
            let own = self.resolve_width(caption, &room, AutoSize::Fill);
            self.measure(caption, self.input_for(caption, own, &room))
                .height
                + margins[1]
        };
        grid.captions.iter().copied().map(height).sum()
    }

    pub(crate) fn table_widths(&mut self, id: BoxId, is_for_layout: bool) -> Widths {
        let (grid, spacing, is_fixed) = self.prepare_table(id);
        let columns = || grid.columns.iter().filter(|it| !it.is_merged);
        let outside =
            self.boxes[id].inset(0.0).sums()[0] + around(columns().count().max(1), spacing[0]);
        let mut min = outside
            + columns()
                .map(|it| {
                    if is_fixed && it.fraction.is_none() {
                        it.max
                    } else {
                        it.min
                    }
                })
                .sum::<f32>();
        let mut max: f32 = columns().map(|it| it.max).sum();
        let shrinks = |it: BoxId| {
            self.boxes[it].is_cell() || matches!(self.boxes[it].kind, Kind::Flex | Kind::Grid)
        };
        let ignores =
            columns().any(|it| it.fraction.is_some()) && self.boxes.containers(id).any(shrinks);
        self.boxes[id].ignores_column_percentages = ignores;
        if is_fixed && crate::layout::is_relative(&self.boxes[id].style.layout.width) {
            max = 1_000_000.0;
        } else if !is_fixed
            && (is_for_layout || !ignores)
            && self.boxes[id].style.layout.width != Size::MaxContent
        {
            let fractions: f32 = columns().filter_map(|it| it.fraction).sum();
            let rest: f32 = columns()
                .filter(|it| it.fraction.is_none())
                .map(|it| it.max)
                .sum();
            let for_rest = if fractions >= 1.0 && rest > 0.0 {
                1_000_000.0
            } else {
                rest / (1.0 - fractions).max(0.0001)
            };
            let for_fractions =
                columns().filter_map(|it| Some(it.max / it.fraction.filter(|it| *it > 0.0)?));
            max = for_fractions.fold(max.max(for_rest), f32::max);
        }
        for caption in &grid.captions {
            min = min.max(self.contribution(*caption, None, None).sizes[0]);
        }
        Widths {
            sizes: [min, unit(outside + max).max(min)],
            uses_height: false,
        }
    }

    #[inline(never)]
    pub(crate) fn lay_out_table(
        &mut self,
        id: BoxId,
        input: &Input,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let (grid, specified, is_fixed) = self.prepare_table(id);
        let spacing = if grid.is_empty() { [0.0; 2] } else { specified };
        let it = &mut self.boxes[id];
        (it.layout.border, it.layout.padding) =
            (Edges::new(it.border()), it.padding(input.basis.0));
        let (style, inset, mut width) =
            (Rc::clone(&it.style), it.inset(input.basis.0), input.width);
        let inner = width - inset.sums()[0];
        let assignable = (inner
            - around(
                grid.columns.iter().filter(|it| !it.is_merged).count(),
                spacing[0],
            ))
        .max(0.0);
        let mut widths = snapped(
            (if is_fixed {
                distribute_fixed
            } else {
                distribute
            })(&grid.columns, assignable),
            assignable,
        );
        let place = |widths: &[f32], collapses: bool| {
            let (mut x, mut is_first) = (0.0, true);
            let starts = grid.columns.iter().zip(widths).map(|(column, width)| {
                let is_skipped = column.is_merged
                    || collapses && column.is_collapsed
                    || core::mem::take(&mut is_first);
                x += width + if is_skipped { 0.0 } else { spacing[0] };
                x - width
            });
            starts.collect::<Vec<f32>>()
        };
        let (mut starts, mut row_width) =
            (place(&widths, false), (inner - 2.0 * spacing[0]).max(0.0));
        let (basis, has_height) = ((row_width, None), !it.has_auto_size(1));
        let cell_input = |cell: &Cell, starts: &[f32], widths: &[f32]| {
            let (last, is_restricted) = (
                cell.column + cell.columns - 1,
                has_height || cell.height.0.is_some(),
            );
            Input {
                width: starts[last] + widths[last] - starts[cell.column],
                basis,
                is_restricted,
                ..Input::default()
            }
        };
        let uncollapsed = (starts.clone(), widths.clone());
        if grid.columns.iter().any(|it| it.is_collapsed) {
            let collapsed = widths
                .iter_mut()
                .zip(&grid.columns)
                .filter(|it| it.1.is_collapsed && !it.1.is_merged);
            let removed: f32 = collapsed.map(|it| core::mem::take(it.0) + spacing[0]).sum();
            let least = grid
                .captions
                .iter()
                .map(|it| self.contribution(*it, None, None).sizes[0])
                .fold(inset.sums()[0], f32::max);
            (starts, row_width, width) = (
                place(&widths, true),
                (row_width - removed).max(0.0),
                (width - removed).max(least),
            );
            self.boxes[id].layout.size.width = width;
        }
        if let Some(lattice) = self.boxes.lattices.get_mut(&id) {
            let lines = starts.iter().copied().chain([starts
                .last()
                .zip(widths.last())
                .map_or(0.0, |it| it.0 + it.1)]);
            lattice.lines = lines
                .map(|it| if style.is_rtl() { row_width - it } else { it })
                .collect();
        }

        let (mut output, mut captions, mut caption_heights) =
            (Output::default(), Vec::new(), [0.0; 2]);
        for caption in &grid.captions {
            let mut margin = margin(&self.boxes[*caption].style, width);
            let room = Room {
                available: [Some(width - margin.sums()[0]), None],
                basis: [Some(width), None],
                height: None,
            };
            let own_width = self.resolve_width(*caption, &room, AutoSize::Fill);
            let own = self.lay_out(*caption, self.input_for(*caption, own_width, &room), None);
            let side =
                usize::from(self.boxes[*caption].style.text.caption_side == CaptionSide::Bottom);
            let x = self.align_in_flow(&style, *caption, width, own_width, &mut margin);
            captions.push((
                *caption,
                side,
                [x, caption_heights[side] + margin.top],
                margin,
            ));
            caption_heights[side] += own.height + margin.sums()[1];
            output.escapes |= own.escapes;
        }
        let [above, below] = caption_heights;

        let mut rows: Vec<Row> = (grid.rows.iter())
            .map(|(row, _)| {
                let (height, fraction) = specified_height(&self.boxes[*row]);
                Row {
                    height: height.unwrap_or(0.0),
                    fraction,
                    is_fixed: height.is_some(),
                    is_collapsed: self.is_collapsed_row(*row),
                    ..Row::default()
                }
            })
            .collect();
        for cell in &grid.cells {
            let ((height, fraction), row) = (cell.height, &mut rows[cell.row]);
            row.starts_span |= cell.rows > 1;
            if cell.rows == 1 {
                row.is_fixed |= height.is_some();
                row.fraction = row.fraction.into_iter().chain(fraction).reduce(f32::max);
            }
        }
        let mut measured = Vec::with_capacity(grid.cells.len());
        for cell in &grid.cells {
            let own = self.measure(cell.id, cell_input(cell, &uncollapsed.0, &uncollapsed.1));
            let it = &self.boxes[cell.id];
            let below = if it.is_ordinary && it.turned == it.mode && !it.uses_parent[0] {
                it.layout.border.bottom + it.layout.padding.bottom
            } else {
                it.border_and_padding(row_width).bottom
            };
            let (baseline, row) = (
                (cell.is_aligned && !it.children.is_empty()).then(|| {
                    own.baselines[0].unwrap_or_else(|| own.intrinsic - below - it.gutters().bottom)
                }),
                &mut rows[cell.row],
            );
            row.baseline = row.baseline.into_iter().chain(baseline).reduce(f32::max);
            row.baseline_uses_height |= baseline.is_some() && own.uses_height;
            row.below_content = Some(row.below_content.map_or(below, |it| it.min(below)));
            let height = cell
                .height
                .0
                .filter(|_| self.environment.quirks == crate::document::Quirks::All)
                .map_or(own.height, |it| it.max(own.intrinsic));
            measured.push((
                [
                    height,
                    if it.is_orthogonal() {
                        own.height
                    } else {
                        own.intrinsic
                    },
                ],
                baseline,
            ));
        }
        let extent = |rows: &[Row]| {
            let shown = || rows.iter().filter(|it| !it.is_collapsed);
            shown().map(|it| it.height).sum::<f32>()
                + spacing[1] * shown().count().saturating_sub(1) as f32
        };
        let mut spanning = Vec::new();
        for (cell, &([height, intrinsic], baseline)) in grid.cells.iter().zip(&measured) {
            let row = &mut rows[cell.row];
            match cell.rows {
                1 => {
                    row.height = row.height.max(height).max(
                        intrinsic
                            + baseline
                                .zip(row.baseline)
                                .map_or(0.0, |(own, row)| row - own),
                    )
                }
                _ => {
                    row.height = row.height.max(baseline.and(row.baseline).unwrap_or(0.0));
                    spanning.push((cell.row..cell.row + cell.rows, height));
                }
            }
        }
        // Not a total order.
        for index in 1..spanning.len().min(2000) {
            let precedes = |a: &(Range<usize>, f32), b: &(Range<usize>, f32)| match () {
                () if a.0 == b.0 => a.1 > b.1,
                () if a.0.start >= b.0.start && a.0.end <= b.0.end => true,
                () => a.0.start < b.0.start && a.0.end < b.0.end,
            };
            let at = spanning[..index]
                .iter()
                .rposition(|it| !precedes(&spanning[index], it))
                .map_or(0, |it| it + 1);
            spanning[at..=index].rotate_right(1);
        }
        let mut first = 0;
        let mut sections: Vec<Section> = (grid.groups.iter())
            .map(|group| {
                let count = grid.rows[first..]
                    .iter()
                    .take_while(|it| it.1 == *group)
                    .count();
                let ((height, fraction), is_body) = (
                    specified_height(&self.boxes[*group]),
                    self.boxes[*group].style.display() == Display::TableRowGroup,
                );
                first += count;
                Section {
                    rows: first - count..first,
                    height: height.unwrap_or(0.0),
                    fraction,
                    is_fixed: height.is_some(),
                    is_body,
                }
            })
            .collect();
        for section in &sections {
            let mut left = 1.0f32;
            for fraction in rows[section.rows.clone()]
                .iter_mut()
                .filter_map(|it| it.fraction.as_mut())
            {
                *fraction = fraction.min(left);
                left -= *fraction;
            }
        }
        spanning
            .into_iter()
            .for_each(|(range, height)| grow_rows(&mut rows[range], height, spacing[1], None));
        for section in &mut sections {
            let rows = &mut rows[section.rows.clone()];
            grow_rows(rows, section.height, spacing[1], Some(section.height));
            section.height = section.height.max(
                rows.iter().map(|it| it.height).sum::<f32>()
                    + spacing[1] * rows.len().saturating_sub(1) as f32,
            );
        }
        let with_rows = sections.iter().filter(|it| !it.rows.is_empty()).count();
        let mut natural = inset.sums()[1]
            + around(with_rows, spacing[1])
            + sections.iter().map(|it| it.height).sum::<f32>();
        let without_captions = |it: f32| it - above - below;
        let for_grid = Input {
            height: input.height.map(without_captions),
            stretch: input.stretch.map(without_captions),
            ..*input
        };
        let is_ignored =
            sections.is_empty() && self.environment.quirks == crate::document::Quirks::All;
        let mut height = self.boxes[id]
            .used_height(&for_grid, Some(natural))
            .filter(|_| !is_ignored)
            .unwrap_or(natural)
            .max(natural);
        grow_sections(
            &mut sections,
            &mut rows,
            height - inset.sums()[1] - around(with_rows, specified[1]),
            specified[1],
        );
        for section in &mut sections {
            let rows = &rows[section.rows.clone()];
            let spacings = rows.len().saturating_sub(1)
                - rows
                    .iter()
                    .filter(|it| !it.is_collapsed)
                    .count()
                    .saturating_sub(1);
            let collapsed = rows
                .iter()
                .filter(|it| it.is_collapsed)
                .map(|it| it.height)
                .sum::<f32>()
                + spacing[1] * spacings as f32;
            (height, natural) = (
                height - collapsed,
                (natural - collapsed).max(inset.sums()[1]),
            );
            section.height = if rows.is_empty() {
                section.height
            } else {
                extent(rows)
            };
        }
        let (has_rows, height) = (!rows.is_empty(), height.max(inset.sums()[1]));
        (output.height, output.intrinsic, output.uses_height) =
            (above + height + below, above + natural + below, true);

        self.boxes[id].caption_heights = caption_heights;
        let (mut bands, mut members) = (Vec::new(), Vec::new());
        let caption_band = |document: &Document,
                            id: BoxId,
                            top: f32,
                            margin: f32,
                            bands: &mut Vec<Band>,
                            members: &mut Vec<Member>| {
            let (input, own) = document.boxes[id].cache.performed();
            members.push(Member {
                id,
                input,
                bands: [bands.len(); 2],
                offsets: [0.0; 2],
                fills: false,
                grows: false,
                moves_alone: false,
            });
            bands.push(Band {
                is_block: true,
                margin,
                ..Band::new(top, own.height, margin.max(0.0))
            });
        };
        for (caption, side, [x, y], margin) in &captions {
            self.place_child(
                *caption,
                [*x, y + if *side == 1 { above + height } else { 0.0 }],
                *margin,
                (width, None),
            );
            if breaks.is_some() && *side == 0 {
                caption_band(self, *caption, *y, margin.top, &mut bands, &mut members);
            }
        }
        let first_row = bands.len();
        let top = above + inset.top + if has_rows { spacing[1] } else { 0.0 };
        let (mut y, mut index, mut cells) = (top, 0, grid.cells.iter().zip(&measured).peekable());
        let is_fragmented = breaks.is_some();
        for (group, section) in grid.groups.iter().zip(&sections) {
            let (mut group_output, mut row_y, first, mut shows_row) =
                (Output::default(), 0.0, index, false);
            let mut in_group = Some(Contents::default());
            while let Some((row, _)) = grid.rows.get(index).filter(|it| it.1 == *group) {
                let shown = if rows[index].is_collapsed {
                    0.0
                } else {
                    rows[index].height
                };
                if !rows[index].is_collapsed && core::mem::replace(&mut shows_row, true) {
                    row_y += spacing[1];
                }
                let (mut row_output, below_row) = (
                    Output {
                        height: shown,
                        ..Output::default()
                    },
                    fixed_height(&self.boxes[*row].style),
                );
                let mut in_row =
                    (!is_fragmented && !rows[index].is_collapsed).then(Contents::default);
                let unaligned = |rows: &[Row], cell: &Cell, measured: f32| {
                    let height = if rows[index].is_collapsed || cell.rows == 1 {
                        shown
                    } else {
                        extent(&rows[index..index + cell.rows])
                    };
                    Input {
                        height: Some(height),
                        is_indefinite: cell.height.0.is_none()
                            && !(has_height && height > measured),
                        ..cell_input(cell, &starts, &widths)
                    }
                };
                if rows[index].baseline_uses_height && !is_fragmented {
                    let aligned = cells
                        .clone()
                        .take_while(|it| it.0.row == index)
                        .filter(|it| it.1.1.is_some());
                    let baselines = aligned.map(|(cell, (own, _))| {
                        let own = self.measure(cell.id, unaligned(&rows, cell, own[0]));
                        own.baselines[0].unwrap_or_else(|| {
                            own.intrinsic - self.boxes[cell.id].inset(row_width).bottom
                        })
                    });
                    rows[index].baseline = baselines.reduce(f32::max);
                }
                while let Some((cell, (own, baseline))) = cells.next_if(|it| it.0.row == index) {
                    let row_baseline = rows[index].baseline.filter(|it| {
                        baseline.is_some_and(|own| own != *it || rows[index].baseline_uses_height)
                    });
                    let input = Input {
                        row_baseline,
                        ..unaligned(&rows, cell, own[0])
                    };
                    row_output.escapes |= self.lay_out(cell.id, input, None).escapes;
                    let x = if style.is_rtl() {
                        row_width - starts[cell.column] - input.width
                    } else {
                        starts[cell.column]
                    };
                    self.place_child(cell.id, [x, 0.0], Edges::default(), (row_width, below_row));
                    in_row.take_if(|it| !it.add(&self.boxes[cell.id]));
                    if is_fragmented {
                        let fills = rows[index + 1..index + cell.rows]
                            .iter()
                            .all(|it| it.height == 0.0)
                            && (cell.rows == 1 || spacing[1] == 0.0);
                        let span = [
                            bands.len(),
                            bands.len() + if fills { 0 } else { cell.rows - 1 },
                        ];
                        let grows = fills && !rows[index].is_collapsed && self.can_grow(cell.id);
                        members.push(Member {
                            id: cell.id,
                            input,
                            bands: span,
                            offsets: [0.0; 2],
                            fills,
                            grows,
                            moves_alone: false,
                        });
                    }
                }
                let baseline = rows[index].baseline.unwrap_or_else(|| {
                    rows[index]
                        .below_content
                        .map_or(0.0, |it| (shown - it).max(0.0))
                });
                output.baselines = [
                    output.baselines[0].or(Some(y + row_y + baseline)),
                    Some(y + row_y + baseline),
                ];
                if breaks.is_some() {
                    let mut band =
                        Band::new(y + row_y, shown, if index > 0 { spacing[1] } else { 0.0 });
                    band.lead = if index == 0 && first_row > 0 {
                        top - above
                    } else {
                        0.0
                    };
                    band.belongs_to(&self.boxes[*row].style, [true; 2]);
                    band.belongs_to(
                        &self.boxes[*group].style,
                        [
                            index == first,
                            grid.rows.get(index + 1).is_none_or(|it| it.1 != *group),
                        ],
                    );
                    bands.push(band);
                } else {
                    self.finish_table_part(
                        *row,
                        [0.0, row_y],
                        row_width,
                        &mut row_output,
                        &mut group_output,
                        None,
                    );
                    in_row
                        .into_iter()
                        .for_each(|it| self.note_extents_of_part(*row, it));
                }
                in_group.take_if(|it| !it.add(&self.boxes[*row]));
                row_y += shown;
                index += 1;
            }
            group_output.height = section.height;
            match is_fragmented && first < index {
                true => self.boxes[*group].layout.size.height = section.height,
                false => self.finish_table_part(
                    *group,
                    [inset.left + spacing[0], y],
                    row_width,
                    &mut group_output,
                    &mut output,
                    None,
                ),
            }
            in_group
                .filter(|_| !is_fragmented)
                .into_iter()
                .for_each(|it| self.note_extents_of_part(*group, it));
            y += if first == index {
                section.height
            } else {
                row_y + spacing[1]
            };
        }
        let mut flow = breaks.map(|it| self.flow(id, input, inset, it));
        let (mut unbroken, mut last_spacing) = (inset.top, if has_rows { spacing[1] } else { 0.0 });
        if let Some(flow) = &mut flow {
            if grid.rows.is_empty() {
                bands.push(Band::new(above, height, 0.0));
            }
            let end = bands.len();
            for (caption, _, [_, y], margin) in captions.iter().filter(|it| it.1 == 1) {
                caption_band(
                    self,
                    *caption,
                    above + height + y,
                    margin.top,
                    &mut bands,
                    &mut members,
                );
            }
            unbroken = bands.last().map_or(unbroken, |it| it.bottom);
            let groups: Vec<_> = grid.rows.chunk_by(|a, b| a.1 == b.1).collect();
            let repeated = [
                (groups.first(), Display::TableHeaderGroup),
                (groups.last(), Display::TableFooterGroup),
            ]
            .map(|(group, display)| {
                let (id, count) = group
                    .map(|it| (it[0].1, it.len()))
                    .filter(|it| it.1 < rows.len())?;
                let height = self.boxes[id].layout.size.height;
                let repeats = self.boxes[id].style.display() == display
                    && self.avoids_break_inside(id)
                    && flow.can_repeat(height);
                repeats.then_some((id, count, height + spacing[1]))
            });
            let body = first_row + repeated[0].map_or(0, |it| it.1)
                ..end - repeated[1].map_or(0, |it| it.1);
            self.fragment_bands(id, flow, &mut bands, &mut members, 0..first_row);
            flow.reserve([0.0, repeated[1].map_or(0.0, |it| it.2)]);
            self.fragment_bands(id, flow, &mut bands, &mut members, first_row..body.start);
            flow.reserve([repeated[0].map_or(0.0, |it| it.2), 0.0]);
            flow.is_separated &= repeated[0].is_none();
            self.fragment_bands(id, flow, &mut bands, &mut members, body.clone());
            flow.release_end();
            flow.is_separated &= repeated[1].is_none();
            self.fragment_bands(id, flow, &mut bands, &mut members, body.end..end);
            let mut first = first_row;
            for group in groups {
                let (rows, mut group_output) =
                    (&bands[first..first + group.len()], Output::default());
                for (index, ((row, _), band)) in group.iter().zip(rows).enumerate() {
                    let mut own = Output {
                        height: flow.place_over(*row, &rows[index..=index]),
                        ..Output::default()
                    };
                    for cell in members[members.partition_point(|it| it.bands[0] < first + index)..]
                        .iter()
                        .take_while(|it| it.bands[0] == first + index)
                    {
                        self.boxes[cell.id].layout.location.y -= band.top;
                        own.escapes |= self.boxes[cell.id].cache.escapes();
                    }
                    self.finish_table_part(
                        *row,
                        [0.0, band.top - rows[0].top],
                        row_width,
                        &mut own,
                        &mut group_output,
                        Some(flow),
                    );
                }
                group_output.height = flow.place_over(group[0].1, rows);
                self.finish_table_part(
                    group[0].1,
                    [inset.left + spacing[0], rows[0].top],
                    row_width,
                    &mut group_output,
                    &mut output,
                    Some(flow),
                );
                first += group.len();
            }
            for (column, ..) in &grid.column_boxes {
                flow.place_over(*column, &bands[first_row..end]);
            }
            flow.repeat(
                repeated[0].map(|it| it.0),
                repeated[1].map(|it| (it.0, spacing[1])),
                &bands[first_row..body.end],
            );
            let dropped = (bands[end - 1].bottom + last_spacing - flow.end())
                .min(last_spacing)
                .max(0.0);
            (last_spacing, unbroken, bands[end - 1].shift) = (
                last_spacing - dropped,
                unbroken + if end == bands.len() { dropped } else { 0.0 },
                bands[end - 1].shift - dropped,
            );
            let all = bands.len();
            self.fragment_bands(id, flow, &mut bands, &mut members, end..all);
            let (row, consumed) = (&bands[first_row], |it: &Band| {
                flow.consumed_in(it.columns[1], it.bottom)
            });
            let (lead, tail) = if grid.rows.is_empty() {
                (0.0, 0.0)
            } else {
                (top - above, last_spacing + inset.bottom)
            };
            let margin = captions.iter().rfind(|it| it.1 == 1).map(|it| it.3.bottom);
            self.boxes[id].caption_heights = [
                flow.consumed_in(row.columns[0], row.top) - lead,
                margin.map_or(0.0, |it| {
                    (consumed(&bands[all - 1]) - consumed(&bands[end - 1]) + it - tail).max(0.0)
                }),
            ];
        }
        for (column, first, end) in &grid.column_boxes {
            let (start, end) = (starts[*first], starts[end - 1] + widths[end - 1]);
            self.boxes[*column].forget_extents();
            let layout = &mut self.boxes[*column].layout;
            *layout = Layout::default();
            layout.location.x = inset.left
                + spacing[0]
                + if style.is_rtl() {
                    row_width - end
                } else {
                    start
                };
            (layout.location.y, layout.size.width, layout.size.height) =
                (top, end - start, (y - top - last_spacing).max(0.0));
        }
        for (column, ..) in &grid.column_boxes {
            let parent = self.boxes[*column].parent;
            if parent != id {
                let origin = self.boxes[parent].layout.location;
                let location = &mut self.boxes[*column].layout.location;
                (location.x, location.y) = (location.x - origin.x, location.y - origin.y);
            }
        }
        if let Some(flow) = flow {
            let y = bands.last().map_or(unbroken, |it| it.bottom);
            let bottom = if below > 0.0 || grid.rows.is_empty() {
                0.0
            } else {
                inset.bottom + last_spacing
            };
            let (fixed, inset) = (
                Some(output.height + flow.consumed(y) - unbroken),
                Edges { bottom, ..inset },
            );
            self.finish_bands(
                id,
                &Input {
                    height: fixed,
                    ..*input
                },
                inset,
                flow,
                [unbroken, y],
                &mut output,
            );
        }
        output
    }

    fn finish_table_part(
        &mut self,
        id: BoxId,
        at: [f32; 2],
        width: f32,
        own: &mut Output,
        parent: &mut Output,
        mut flow: Option<&mut Flow>,
    ) {
        let it = &mut self.boxes[id];
        it.layout = Layout::default();
        (it.layout.size.width, it.layout.size.height) = (width, own.height);
        it.cache.clear();
        it.forget_extents();
        if !self.boxes.pieces.is_empty() {
            self.boxes.pieces.remove(&id);
            self.boxes.copies.remove(&id);
        }
        self.settle_children(id);
        self.lay_out_positioned(id, own, flow.as_mut().map(|it| &mut *it.breaks));
        self.place_child(
            id,
            at,
            Edges::default(),
            (
                width,
                fixed_height(&self.boxes[self.boxes[id].parent].style),
            ),
        );
        flow.iter_mut()
            .for_each(|it| it.shift(id, self.boxes[id].layout.location.y - at[1]));
        parent.escapes |= own.escapes;
    }

    pub(crate) fn is_collapsed_row(&self, id: BoxId) -> bool {
        self.boxes[id].kind == Kind::Row
            && [id, self.boxes[id].parent]
                .iter()
                .any(|it| self.boxes[*it].style.ink.visibility.0 == Visibility::Collapse)
    }
}

#[derive(Clone, Copy, Default)]
struct Row {
    height: f32,
    fraction: Option<f32>,
    is_fixed: bool,
    is_collapsed: bool,
    starts_span: bool,
    baseline: Option<f32>,
    baseline_uses_height: bool,
    /// The least border and padding at the bottom of a cell.
    below_content: Option<f32>,
}

struct Section {
    rows: Range<usize>,
    height: f32,
    fraction: Option<f32>,
    is_fixed: bool,
    is_body: bool,
}

fn specified_height(it: &LayoutBox) -> (Option<f32>, Option<f32>) {
    match it.style.layout.height {
        Size::Length(Lp::Px(px)) => (Some(unit(px)), None),
        Size::Length(Lp::Fraction(fraction)) => (None, Some(fraction)),
        _ => (None, None),
    }
}

fn fixed_height(style: &Style) -> Option<f32> {
    if let Size::Length(Lp::Px(px)) = style.layout.height {
        Some(px)
    } else {
        None
    }
}

fn around(count: usize, spacing: f32) -> f32 {
    if count > 0 {
        spacing * (count + 1) as f32
    } else {
        0.0
    }
}

/// By the first of the `weights` that do not all vanish.
fn shares<T>(all: &[T], extra: f32, weights: &[&dyn Fn(usize, &T) -> f32]) -> Vec<f32> {
    let of = |weight: &dyn Fn(usize, &T) -> f32| {
        all.iter()
            .enumerate()
            .map(|(index, it)| weight(index, it))
            .collect::<Vec<_>>()
    };
    let weights = weights
        .iter()
        .map(|it| of(*it))
        .find(|it| it.iter().any(|it| *it > 0.0))
        .unwrap_or_default();
    let total: f32 = weights.iter().sum();
    snapped(
        weights.into_iter().map(|it| extra * it / total).collect(),
        extra,
    )
}

/// `basis` is what percentages refer to, and is `None` for the height of a cell that spans the rows.
fn grow_rows(rows: &mut [Row], height: f32, spacing: f32, basis: Option<f32>) {
    let mut extra = height
        - spacing * rows.len().saturating_sub(1) as f32
        - rows.iter().map(|it| it.height).sum::<f32>();
    if extra <= 0.0 {
        return;
    }
    let deficit = |_, it: &Row| {
        it.fraction.zip(basis).map_or(0.0, |(fraction, basis)| {
            (unit(fraction * basis) - it.height).max(0.0)
        })
    };
    let given = rows.iter().map(|it| deficit(0, it)).sum::<f32>().min(extra);
    let before: Vec<_> = rows.iter().map(|it| it.height).collect();
    shares(rows, given, &[&deficit])
        .into_iter()
        .zip(&mut *rows)
        .for_each(|(share, it)| it.height += share);
    extra -= given;
    let is_auto = |it: &Row| {
        !it.is_fixed && it.fraction.is_none() || it.fraction.is_some() && basis.is_none()
    };
    let (last, are_empty) = (
        rows.len().saturating_sub(1),
        rows.iter().all(|it| it.height == 0.0),
    );
    let weights: [&dyn Fn(usize, &Row) -> f32; 6] = [
        &|index, it| f32::from(basis.is_none() && index > 0 && it.starts_span),
        &|index, it| if is_auto(it) { before[index] } else { 0.0 },
        &|index, _| f32::from(basis.is_none() && are_empty && index == last),
        &|_, it| f32::from(basis.is_some() && it.height == 0.0 && is_auto(it)),
        &|_, it| f32::from(basis.is_some() && it.height == 0.0),
        &|_, it| it.height,
    ];
    shares(rows, extra, &weights)
        .into_iter()
        .zip(rows)
        .for_each(|(share, it)| it.height += share);
}

fn grow_sections(sections: &mut [Section], rows: &mut [Row], height: f32, spacing: f32) {
    let mut extra = height - sections.iter().map(|it| it.height).sum::<f32>();
    if extra <= 0.0 {
        return;
    }
    let deficit = |_, it: &Section| {
        it.fraction.map_or(0.0, |fraction| {
            (unit(fraction * height) - it.height).max(0.0)
        })
    };
    let given = sections
        .iter()
        .map(|it| deficit(0, it))
        .sum::<f32>()
        .min(extra);
    shares(sections, given, &[&deficit])
        .into_iter()
        .zip(&mut *sections)
        .for_each(|(share, it)| it.height += share);
    extra -= given;
    let rank = |it: &Section| (!it.is_body, it.fraction.is_some(), it.is_fixed);
    let best = sections.iter().map(rank).min();
    let weights: [&dyn Fn(usize, &Section) -> f32; 2] = [
        &|_, it| {
            if Some(rank(it)) == best {
                it.height
            } else {
                0.0
            }
        },
        &|_, it| f32::from(Some(rank(it)) == best),
    ];
    shares(sections, extra, &weights)
        .into_iter()
        .zip(&mut *sections)
        .for_each(|(share, it)| it.height += share);
    sections.iter().for_each(|it| {
        grow_rows(
            &mut rows[it.rows.clone()],
            it.height,
            spacing,
            Some(it.height),
        )
    });
}
