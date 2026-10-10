use crate::oxlint::vue::{define_component_object, exported_object, key_name, key_span, object_properties};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using deprecated `destroyed` and `beforeDestroy` lifecycle hooks in Vue.js 3.0.0+.
pub struct NoDeprecatedDestroyedLifecycle;

const NO_DEPRECATED_DESTROYED_LIFECYCLE: Message =
    Message::new("", "The `{{deprecated}}` lifecycle hook is deprecated. Use `{{replacement}}` instead.");

impl Rule for NoDeprecatedDestroyedLifecycle {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-destroyed-lifecycle", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::ExportDefault]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDeprecatedDestroyedLifecycle
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(&["beforeDestroy", "destroyed"]) {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let call = match stmt.kind() {
            StmtKind::ExportDefault(e) if !e.is_parenthesized() && !e.is_chain_root() => e.as_call(),
            _ => None,
        };
        if let Some(properties) = exported_object(stmt).or_else(|| call.and_then(define_component_object)) {
            check_object_properties(properties, cx);
        }
    }
}

fn check_object_properties<'a>(properties: List<'a, Prop<'a>>, cx: &Cx<'a, NoDeprecatedDestroyedLifecycle>) {
    let exists = |name: &str| object_properties(properties).filter_map(key_name).any(|it| it.is(name));
    // Whether there is a property of the new name, with which a fix would make a second.
    let (mut has_before_unmount, mut has_unmounted) = (exists("beforeUnmount"), exists("unmounted"));
    for prop in object_properties(properties) {
        let Some(key) = prop.key() else {
            continue;
        };
        let (key_name, quote) = match key.kind() {
            KeyKind::Ident(name) => (name, None),
            KeyKind::String(name) => (name, Some(b'\'')),
            KeyKind::ComputedString(name) if cx.file().slice(key_span(prop)).starts_with(b"`") => (name, Some(b'`')),
            KeyKind::ComputedString(name) => (name, Some(b'\'')),
            _ => continue,
        };
        let (replacement, is_taken) = match key_name.bytes() {
            b"beforeDestroy" => ("beforeUnmount", &mut has_before_unmount),
            b"destroyed" => ("unmounted", &mut has_unmounted),
            _ => continue,
        };
        let report = cx.report(key_span(prop), NO_DEPRECATED_DESTROYED_LIFECYCLE);
        let report = report.data("deprecated", key_name).data("replacement", replacement);
        if !std::mem::replace(is_taken, true) {
            report.fix(|fixer| {
                let formatted_replacement = match quote {
                    Some(quote) => [&[quote][..], replacement.as_bytes(), &[quote][..]].concat(),
                    None if prop.kind() == PropKind::Shorthand => [replacement.as_bytes(), &b":"[..], key_name.bytes()].concat(),
                    None => replacement.as_bytes().to_vec(),
                };
                fixer.replace(key_span(prop), formatted_replacement)
            });
        }
    }
}
