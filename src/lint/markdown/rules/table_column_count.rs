use crate::prelude::*;

/// Disallow data rows in a GitHub Flavored Markdown table from having more cells than the header row
pub struct TableColumnCount {
    check_missing_cells: bool,
}

const EXTRA_CELLS: &Message = &Message::new(
    "extraCells",
    "Table column count mismatch (Expected: {{expectedCells}}, Actual: {{actualCells}}), extra data starting here will be ignored.",
);
const MISSING_CELLS: &Message = &Message::new(
    "missingCells",
    "Table column count mismatch (Expected: {{expectedCells}}, Actual: {{actualCells}}), row might be missing data.",
);

impl Rule for TableColumnCount {
    const META: Meta = meta_for_gfm("table-column-count").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        TableColumnCount {
            check_missing_cells: options.object(0).bool_or("checkMissingCells", false),
        }
    }
}

impl Listens for TableColumnCount {
    const LISTENERS: &'static [Listener] = &[Listener::new("table", Kinds::of(&[Kind::Table]))];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        _: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let mut rows = node.children();
        let Some(header) = rows.next() else {
            return Ok(());
        };
        let expected = header.children().count();
        for row in rows {
            let actual = row.children().count();
            let Some(last) = row.last_child() else {
                continue;
            };
            let (locs, message) = if actual > expected {
                let first_extra = row.children().nth(expected).unwrap_or(last);
                ((first_extra.start(), last.end()), EXTRA_CELLS)
            } else if self.check_missing_cells && actual < expected {
                let start = Loc {
                    line: last.end().line,
                    column: last.end().column - 1,
                };
                ((start, row.end()), MISSING_CELLS)
            } else {
                continue;
            };
            let (actual, expected) = (actual.to_string(), expected.to_string());
            let data = [
                ("actualCells", actual.as_bytes()),
                ("expectedCells", expected.as_bytes()),
            ];
            cx.report(locs, message, &data);
        }
        Ok(())
    }
}
