//! `bun build --dts` declares a JSON module with this. The declaration transformer has no part in it.

use super::enclosing_declaration::Enclosing;
use super::print::{DECLARATION_EMIT_NODE_BUILDER_FLAGS, Report, SymbolTracker};
use super::*;

/// The type of a JSON value names no symbol, so its length is all that can stop the printer.
#[derive(Default)]
struct TooLong(bool);

impl<'p> SymbolTracker<'p> for TooLong {
    fn track_symbol(
        &mut self,
        _: &mut Checker<'p, '_>,
        _: Sym,
        _: Option<Enclosing>,
        _: SymFlags,
    ) -> bool {
        false
    }

    fn report(&mut self, _: &mut Checker<'p, '_>, _: Report) {}

    fn report_inference_fallback(&mut self, _: &mut Checker<'p, '_>, _: FileId, _: hir::Node) {}

    fn report_truncation_error(&mut self, _: &mut Checker<'p, '_>) {
        self.0 = true;
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `declare const _exports: T; export = _exports;` for the type `T` of the JSON module `file`. `None` is TS7056.
    pub fn json_module_declaration(&self, file: FileId) -> Option<Vec<u8>> {
        // A checker of its own widens the value: what a checker has checked decides how it orders the properties.
        let mut printer = Box::new(self.p.checker());
        (printer.stack_base, printer.stack_limit) = (self.stack_base, self.stack_limit);
        let hir = printer.hir(file);
        let value = hir.ids(hir.body).find_map(|s| match hir[s].kind {
            StmtKind::ExportAssign(value) => Some(value),
            _ => None,
        });
        // As `type_of_symbol` types the module: a text without a token is `{}`.
        let ty = match value.filter(|&value| hir.text.get(hir[value].pos as usize).is_some()) {
            Some(value) => {
                let ty = printer.type_of_expr(file, value);
                printer.widened(ty)
            }
            None => TypeId::EMPTY_OBJECT,
        };
        let mut too_long = TooLong::default();
        printer.declaration_indent = Some(0);
        // Without an enclosing declaration, so that each property is printed from its type and not from its syntax.
        let flags = DECLARATION_EMIT_NODE_BUILDER_FLAGS;
        let ty = printer.type_to_type_node(ty, None, flags, Some(&mut too_long));
        let text = [
            &b"declare const _exports: "[..],
            &ty[..],
            b";\nexport = _exports;\n",
        ];
        (!too_long.0).then(|| text.concat())
    }
}
