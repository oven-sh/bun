use crate::import_settings::Settings;
use crate::module_visitor::static_require;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::node::{is_builtin_module, is_builtin_module_in};

/// Enforce either using, or omitting, the `node:` protocol when importing Node.js builtin modules.
pub struct EnforceNodeProtocolUsage {
    is_never: bool,
}

const REQUIRE_NODE_PROTOCOL: Message = Message::new("", "Prefer `node:{{moduleName}}` over `{{moduleName}}`.");
const FORBID_NODE_PROTOCOL: Message = Message::new("", "Prefer `{{moduleName}}` over `node:{{moduleName}}`.");

const DECLARATIONS: [StmtTag; 2] = [StmtTag::Import, StmtTag::ExportNamed];

impl Rule for EnforceNodeProtocolUsage {
    const META: Meta =
        Meta::plugin(Plugin::Import, "enforce-node-protocol-usage", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::ImportCall]).stmts(&DECLARATIONS);
    /// `import/node-version`
    type State<'a> = Option<[u32; 3]>;

    fn new(options: &Options) -> Self {
        EnforceNodeProtocolUsage { is_never: options.str(0) == Some("never") }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::ImportCall]).stmts(&DECLARATIONS);
        if file.mentions("require") { on.exprs(&[ExprTag::Call]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        match Settings::new(file.settings()).node_version() {
            None => Some(None),
            // Upstream throws at what is no version.
            Some(node_version) => Some(Some(version_of(node_version.as_str()?)?)),
        }
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let src = match node.kind() {
            ExprKind::Call(call) if !call.is_optional() => static_require(call),
            ExprKind::ImportCall { args } => args.first(),
            _ => None,
        };
        if let Some(src) = src
            && let Some(module_name) = src.as_string()
        {
            self.check_and_report(src.span(), module_name.bytes(), cx);
        }
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let module_name = match node.kind() {
            StmtKind::Import(import) => Some(import.spec()),
            StmtKind::ExportNamed(export) => export.spec(),
            _ => None,
        };
        if let Some(module_name) = module_name
            && let Some(src) = node.module_specifier_span()
        {
            self.check_and_report(src, module_name.bytes(), cx);
        }
    }
}

impl EnforceNodeProtocolUsage {
    fn check_and_report<'a>(&self, src: Span, module_name: &'a [u8], cx: &Cx<'a, Self>) {
        let is_core_module = |name: &[u8]| match cx.state {
            Some(node_version) => is_builtin_module_in(name, node_version),
            None => is_builtin_module(name),
        };
        let first_character_index = src.start + 1;
        match module_name.strip_prefix(b"node:") {
            Some(actual_module_name) if self.is_never && is_core_module(actual_module_name) => {
                cx.report(src, FORBID_NODE_PROTOCOL).data("moduleName", actual_module_name).fix(|fixer| {
                    // Five characters of the source, whatever they are: `"\x6eode:fs"`.
                    let written = fixer.file().slice(Span::new(first_character_index, src.end));
                    let length = strings::wtf8_offset_of_utf16_index(written, 5) as u32;
                    fixer.remove(Span::new(first_character_index, first_character_index + length))
                });
            }
            None if !self.is_never
                && is_core_module(module_name)
                && is_core_module(&[&b"node:"[..], module_name].concat()) =>
            {
                cx.report(src, REQUIRE_NODE_PROTOCOL)
                    .data("moduleName", module_name)
                    .fix(|fixer| fixer.replace(Span::empty(first_character_index), "node:"));
            }
            _ => {}
        }
    }
}

/// `/^[0-9]+\.[0-9]+\.[0-9]+$/`
fn version_of(written: &[u8]) -> Option<[u32; 3]> {
    let mut parts = strings::split(written, b".").map(|part| {
        let is_number = !part.is_empty() && part.iter().all(u8::is_ascii_digit);
        let digits = part.iter().map(|digit| u32::from(digit - b'0'));
        is_number.then(|| digits.fold(0u32, |it, digit| it.saturating_mul(10).saturating_add(digit)))
    });
    let version = [parts.next()??, parts.next()??, parts.next()??];
    parts.next().is_none().then_some(version)
}
