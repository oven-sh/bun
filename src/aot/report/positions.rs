use bun_sema::util::SharedSort;

use super::ReportInput;
use super::format::PathPrinter;
use super::source_texts::ModuleLocator;
use crate::diagnostics::SourcePosition;
use crate::engine::{Position, SourceLocation, position_of};
use crate::ir::ids::{FunctionId, ModuleId};
use crate::link::{ModuleOrigin, ProgramNames};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum PathStyle {
    Native,
    Posix,
}

pub(super) struct Positions<'a> {
    names: &'a ProgramNames,
    pub(super) locator: ModuleLocator<'a>,
    printer: PathPrinter,
    style: PathStyle,
    last_shown_path: Option<(ModuleId, Vec<u8>)>,
}

impl<'a> Positions<'a> {
    pub(super) fn new(input: &ReportInput<'a>, style: PathStyle) -> Positions<'a> {
        Positions {
            names: input.names,
            locator: ModuleLocator::new(input.texts),
            printer: PathPrinter::new(),
            style,
            last_shown_path: None,
        }
    }

    pub(super) fn resolve(&mut self, position: Position) -> Option<SourcePosition> {
        let (line, column) = self.locator.line_and_column(position)?;
        Some(SourcePosition {
            path: self.shown_module_path(position.module),
            line,
            column,
        })
    }

    fn shown_module_path(&mut self, module: ModuleId) -> Vec<u8> {
        if let Some((last_module, path)) = &self.last_shown_path
            && *last_module == module
        {
            return path.clone();
        }
        let path = self.names.module_path(module);
        let path = match self.style {
            PathStyle::Posix => self.printer.posix_path(path),
            PathStyle::Native => {
                let mut shown = Vec::new();
                self.printer.write_path(&mut shown, path);
                shown
            }
        };
        self.last_shown_path = Some((module, path.clone()));
        path
    }

    pub(super) fn resolve_location(&mut self, location: SourceLocation) -> Option<SourcePosition> {
        self.resolve(position_of(location)?)
    }
}

/// A report for users neither counts nor lists a site in one of Bun's own modules. A site without a location is in the module of its function.
pub(super) fn is_listed_site(
    names: &ProgramNames,
    location: SourceLocation,
    function: Option<FunctionId>,
) -> bool {
    let module = match position_of(location) {
        Some(position) => Some(position.module),
        None => function.and_then(|function| names.function_module(function)),
    };
    match module.map(|module| names.module_origin(module)) {
        Some(ModuleOrigin::Runtime) => false,
        Some(ModuleOrigin::Program | ModuleOrigin::Dependency) | None => true,
    }
}

pub(super) fn resolve_ascending<T: Clone>(
    wanted: &[Option<Position>],
    mut resolve: impl FnMut(Position) -> Option<T>,
) -> Vec<Option<T>> {
    let mut order: Vec<(Position, usize)> = wanted
        .iter()
        .enumerate()
        .filter_map(|(index, &position)| Some((position?, index)))
        .collect();
    // Ascending, so the locator scans the text of each module once.
    order.shared_sort_unstable();

    let mut resolved: Vec<Option<T>> = vec![None; wanted.len()];
    let mut previous: Option<(Position, usize)> = None;
    for (position, index) in order {
        resolved[index] = match previous {
            Some((resolved_position, resolved_index)) if resolved_position == position => {
                resolved[resolved_index].clone()
            }
            _ => resolve(position),
        };
        previous = Some((position, index));
    }
    resolved
}

pub(super) fn write_shown_position(out: &mut Vec<u8>, position: Option<&SourcePosition>) {
    let Some(position) = position else {
        out.extend_from_slice(b"(no location)");
        return;
    };
    out.extend_from_slice(&position.path);
    out.extend_from_slice(format!(":{}:{}", position.line, position.column).as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::ids::{Id, ModuleId};
    use bstr::BString;

    fn at(module: usize, offset: u32) -> Option<Position> {
        Some(Position {
            module: ModuleId::new(module),
            offset,
        })
    }

    #[test]
    fn positions_resolve_once_in_ascending_order() {
        let wanted = [at(1, 4), None, at(0, 9), at(1, 4), at(0, 2)];
        let mut asked = Vec::new();
        let resolved = resolve_ascending(&wanted, |position| {
            asked.push(Some(position));
            Some(position.offset)
        });
        assert_eq!(asked, [at(0, 2), at(0, 9), at(1, 4)]);
        assert_eq!(resolved, [Some(4), None, Some(9), Some(4), Some(2)]);
    }

    #[test]
    fn unresolved_position_stays_absent() {
        let wanted = [at(0, 1), at(0, 2), at(0, 1)];
        let resolved = resolve_ascending(&wanted, |position| (position.offset == 2).then_some(()));
        assert_eq!(resolved, [None, Some(()), None]);
    }

    #[test]
    fn shown_position_has_plain_numbers() {
        let position = SourcePosition {
            path: b"src/a.ts".to_vec(),
            line: 1204,
            column: 37,
        };
        let mut out = Vec::new();
        write_shown_position(&mut out, Some(&position));
        assert_eq!(BString::from(out), "src/a.ts:1204:37");
    }

    #[test]
    fn absent_position_prints_placeholder() {
        let mut out = Vec::new();
        write_shown_position(&mut out, None);
        assert_eq!(BString::from(out), "(no location)");
    }
}
