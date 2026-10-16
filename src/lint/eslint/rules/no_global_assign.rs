use bun_lint::prelude::*;

/// Disallow assignments to native objects or read-only global variables.
pub struct NoAssign<const IS_NATIVE_REASSIGN: bool> {
    exceptions: Vec<Box<[u8]>>,
}

pub type NoGlobalAssign = NoAssign<false>;

impl<const IS_NATIVE_REASSIGN: bool> NoAssign<IS_NATIVE_REASSIGN> {
    const MESSAGE: Message = match IS_NATIVE_REASSIGN {
        true => Message::new(
            "nativeReassign",
            "Read-only global '{{name}}' should not be modified.",
        ),
        false => Message::new(
            "globalShouldNotBeModified",
            "Read-only global '{{name}}' should not be modified.",
        ),
    };

    fn check<'a>(&self, references: impl IntoIterator<Item = Reference<'a>>, cx: &Cx<'a, Self>) {
        for reference in ast_utils::get_modifying_references(references) {
            let name = reference.name();
            let is_read_only = (cx.file().global(name.bytes()))
                .is_some_and(|global| !global.is_writable && global.accepts(reference.is_type()));
            if is_read_only && !self.exceptions.iter().any(|it| **it == *name.bytes()) {
                cx.report(reference.ident(), Self::MESSAGE).data("name", name);
            }
        }
    }
}

impl<const IS_NATIVE_REASSIGN: bool> Rule for NoAssign<IS_NATIVE_REASSIGN> {
    const META: Meta = match IS_NATIVE_REASSIGN {
        true => Meta::eslint("no-native-reassign", Kind::Suggestion).deprecated(),
        false => Meta::eslint("no-global-assign", Kind::Suggestion).recommended(),
    };
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        let exceptions = options.object(0).strings("exceptions");
        NoAssign {
            exceptions: exceptions.into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        self.check(file.unresolved_references().filter(|it| it.is_write()), cx);
        // What a script declares at its top level is the global variable of that name.
        for symbol in file.scope().symbols().filter(|it| it.has_modifying_references()) {
            self.check(symbol.references(), cx);
        }
    }
}
