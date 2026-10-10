use crate::react::is_react_function_call;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Ensure destructuring and symmetric naming of useState hook value and setter variables
pub struct HookUseState {
    allow_destructured_state: bool,
}

const USE_STATE_ERROR_MESSAGE: Message =
    Message::new("useStateErrorMessage", "useState call is not destructured into value + setter pair");
const USE_STATE_ERROR_MESSAGE_OR_ADD_OPTION: Message = Message::new(
    "useStateErrorMessageOrAddOption",
    "useState call is not destructured into value + setter pair (you can allow destructuring by enabling \
     \"allowDestructuredState\" option)",
);
const SUGGEST_PAIR: Message = Message::new("suggestPair", "Destructure useState call into value + setter pair");
const SUGGEST_MEMO: Message = Message::new("suggestMemo", "Replace useState call with useMemo");
const REQUIRE_TO_DESTRUCT: Message = Message::new("", "useState call is not destructured into value + setter pair");
const FOLLOW_NAMING_CONVENTION: Message =
    Message::new("", "useState call does not follow the [thing, setThing] naming convention");

/// What every object has: upstream looks the names of references up in a plain object.
const OBJECT_PROTOTYPE: [&str; 12] = [
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

/// What `Components.detect` collects of the `import .. from "react"`. It has what is above the node that it is at.
#[derive(Default)]
pub struct ReactImports<'a> {
    /// Where they start, in the order of the source.
    starts: SmallVec<[u32; 2]>,
    /// `getDefaultReactImports()[0].local`
    default: Option<Ident<'a>>,
    /// `getNamedReactImports()[0]`, and the first of them that import `useState` and `useMemo`.
    named: Option<ImportSpec<'a>>,
    use_state: Option<ImportSpec<'a>>,
    use_memo: Option<ImportSpec<'a>>,
    /// `reactHookImportNames`, by the local name.
    hooks: FxHashMap<Name<'a>, ImportSpec<'a>>,
    first_references: FxHashMap<Asked<'a>, Option<Reference<'a>>>,
}

/// The first reference in `scope` to `react`, or without it to a hook, with that many imports above.
#[derive(PartialEq, Eq, Hash)]
struct Asked<'a> {
    scope: Scope<'a>,
    imports: usize,
    react: Option<Name<'a>>,
}

impl Rule for HookUseState {
    const META: Meta = Meta::plugin(Plugin::React, "hook-use-state", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ReactImports<'a>;

    fn new(options: &Options) -> Self {
        HookUseState { allow_destructured_state: options.object(0).bool_or("allowDestructuredState", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<ReactImports<'a>> {
        if !file.mentions("useState") {
            return None;
        }
        // oxlint goes by the names, whatever is imported.
        if file.language().is_oxlint {
            return Some(ReactImports::default());
        }
        let imports = ReactImports::new(file);
        (!imports.starts.is_empty()).then_some(imports)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let is_use_state = match is_oxlint {
            true => e.as_call().is_some_and(|call| is_react_function_call(call, "useState")),
            false => cx.state.is_use_state_call(e),
        };
        if !is_use_state {
            return;
        }
        let not_destructured = if is_oxlint { REQUIRE_TO_DESTRUCT } else { USE_STATE_ERROR_MESSAGE };
        // oxlint has a node for parentheses.
        let is_child = !e.is_chain_root() && !(is_oxlint && e.is_parenthesized());
        let var = match e.parent() {
            Node::VarDecl(var) if is_child => var,
            Node::Stmt(statement) if is_child && statement.tag() == StmtTag::Return => return,
            _ => {
                cx.report(e, not_destructured);
                return;
            }
        };
        let array_pattern = var.pat();
        let PatKind::Array(elements) = array_pattern.kind() else {
            // oxlint points at the declarator.
            cx.report(if is_oxlint { var.span() } else { e.span() }, not_destructured);
            return;
        };
        // `valueVariable`, `setterVariable`, if they are names or patterns. For oxlint `a = 1` is what `a` is.
        let variable = |i: usize| {
            let is_plain = |it: &PatElem<'a>| !it.is_rest() && (is_oxlint || it.default().is_none());
            elements.get(i).filter(is_plain).and_then(PatElem::pat)
        };
        let (value_node, setter_node) = (variable(0), variable(1));
        let names = (value_node.and_then(Pat::as_ident), setter_node.and_then(Pat::as_ident));
        if elements.len() == 2
            && let (Some(value), Some(setter)) = names
            && is_setter_of(setter.bytes(), value.bytes())
        {
            return;
        }
        if is_oxlint {
            let message = match names {
                _ if elements.len() != 2 || elements.iter().any(PatElem::is_rest) => REQUIRE_TO_DESTRUCT,
                // A hole is fine.
                _ if value_node.is_none() || setter_node.is_none() => return,
                (None, Some(_)) if self.allow_destructured_state => return,
                (_, None) | (None, Some(_)) => REQUIRE_TO_DESTRUCT,
                (Some(_), Some(_)) => FOLLOW_NAMING_CONVENTION,
            };
            cx.report(array_pattern, message);
            return;
        }
        let is_node_destructuring = |it: Option<Pat<'a>>| it.is_some_and(|it| it.as_ident().is_none());
        let id = var.binding_span();
        // `isOnlyValueDestructuring`
        if is_node_destructuring(value_node) && !is_node_destructuring(setter_node) {
            if !self.allow_destructured_state {
                cx.report(id, USE_STATE_ERROR_MESSAGE_OR_ADD_OPTION);
            }
            return;
        }
        let is_single_getter = elements.len() == 1;
        cx.report(id, USE_STATE_ERROR_MESSAGE)
            .suggest(SUGGEST_MEMO, |fixer| cx.state.use_memo(fixer, e, id, names.0.filter(|_| is_single_getter)?))
            .suggest(SUGGEST_PAIR, |fixer| match names.0?.bytes() {
                value @ [first @ b'a'..=b'z', rest @ ..] => {
                    let first = [first.to_ascii_uppercase()];
                    Some(fixer.replace(id, [&b"["[..], value, b", set", &first, rest, b"]"].concat()))
                }
                _ => None,
            });
    }
}

impl<'a> ReactImports<'a> {
    fn new(file: &'a File<'a>) -> ReactImports<'a> {
        let react = file.stmts_of_kind(StmtTag::Import).filter_map(|it| match it.kind() {
            StmtKind::Import(import) if import.spec().is("react") => Some(import),
            _ => None,
        });
        let mut react: SmallVec<[Import<'a>; 2]> = react.collect();
        react.sort_unstable_by_key(|it| it.span().start);
        let mut all = ReactImports::default();
        for import in react {
            all.starts.push(import.span().start);
            all.default = all.default.or_else(|| import.default());
            for specifier in import.named().iter() {
                all.named = all.named.or(Some(specifier));
                // A name in quotes is no `Identifier`.
                let imported = specifier.imported();
                if imported.is_string() || !is_hook_name(imported.bytes()) {
                    continue;
                }
                all.hooks.insert(specifier.local().name(), specifier);
                match imported.bytes() {
                    b"useState" => all.use_state = all.use_state.or(Some(specifier)),
                    b"useMemo" => all.use_memo = all.use_memo.or(Some(specifier)),
                    _ => {}
                }
            }
        }
        all
    }

    /// `utils.isReactHookCall(node, ["useState"])`
    fn is_use_state_call(&mut self, e: Expr<'a>) -> bool {
        let Some(callee) = e.callee() else {
            return false;
        };
        let local_hook_name = match callee.kind() {
            ExprKind::Ident(name) => Some(name),
            ExprKind::Dot { name, .. } if !callee.is_private_member() => Some(name.name()),
            ExprKind::Index { index, .. } => index.as_ident(),
            _ => None,
        };
        let Some(local_hook_name) = local_hook_name.filter(|it| is_hook_name(it.bytes()) && !callee.is_chain_root())
        else {
            return false;
        };
        let ReactImports { starts, default, named, hooks, first_references, .. } = self;
        let at = e.span().start;
        let imported_hook = |local: Name<'a>| hooks.get(&local).copied().filter(|it| it.span().start < at);
        let hook_name = imported_hook(local_hook_name).map_or(local_hook_name, |it| it.imported().name());
        if !hook_name.is("useState") {
            return false;
        }
        // `isPotentialReactHookCall` with the name of the default import, `isPotentialHookCall` without.
        let react = match callee.object() {
            Some(object) => match default.filter(|it| it.start() < at) {
                Some(react) if object.as_ident() == Some(react.name()) => Some(react.name()),
                _ => return false,
            },
            None if named.is_some_and(|it| it.span().start < at) => None,
            None => return false,
        };
        let scope = Node::Expr(e).scope();
        let is_asked_for = |it: &Reference<'a>| match react {
            Some(react) => it.name() == react,
            None => imported_hook(it.name()).is_some() || it.name().is_any(&OBJECT_PROTOTYPE),
        };
        let asked = Asked { scope, imports: starts.partition_point(|it| *it < at), react };
        let first = first_references.entry(asked).or_insert_with(|| scope.references().find(is_asked_for));
        let Some(first) = *first else {
            return false;
        };
        match first.symbol() {
            Some(symbol) => {
                let is_import = |it: Declaration<'a>| it.kind() == Some(DeclarationKind::ImportBinding);
                (react.is_none() && first.name() != local_hook_name) || symbol.declarations().all(is_import)
            }
            // Where it resolves to nothing upstream throws.
            None => first.global().is_some(),
        }
    }

    /// The fix of `suggestMemo`.
    #[cold]
    #[inline(never)]
    fn use_memo(&self, fixer: Fixer<'a>, e: Expr<'a>, id: Span, value: Name<'a>) -> Option<Vec<Fix>> {
        let arguments = e.as_call()?.args();
        let argument = arguments.first().filter(|_| arguments.len() == 1)?;
        let is_above = |it: &ImportSpec<'a>| it.span().start < e.span().start;
        let react = self.default.filter(|it| it.start() < e.span().start);
        let use_memo = self.use_memo.filter(is_above);
        let use_memo_code = match (use_memo, react) {
            (Some(specifier), _) => specifier.local().bytes().to_vec(),
            (None, Some(react)) => [react.bytes(), b".useMemo"].concat(),
            (None, None) => b"useMemo".to_vec(),
        };
        let use_state = self.use_state.filter(is_above).filter(|_| use_memo.is_none() || react.is_some());
        let import = use_state.map(|it| fixer.insert_after(it, ", useMemo"));
        let call = [&use_memo_code[..], b"(() => ", argument.text(), b", [])"].concat();
        Some(import.into_iter().chain([fixer.replace(id, value), fixer.replace(e, call)]).collect())
    }
}

/// `USE_HOOK_PREFIX_REGEX`
fn is_hook_name(name: &[u8]) -> bool {
    matches!(name, [b'u', b's', b'e', b'A'..=b'Z', ..])
}

/// `setFooBar` or `setFOOBar` for `fooBar`.
fn is_setter_of(setter: &[u8], value: &[u8]) -> bool {
    let (lowercase_prefix, suffix) = value.split_at(value.iter().take_while(|it| it.is_ascii_lowercase()).count());
    let Some((prefix, rest)) = setter.strip_prefix(b"set").and_then(|it| it.split_at_checked(lowercase_prefix.len()))
    else {
        return false;
    };
    let is_capitalized = || match (prefix, lowercase_prefix) {
        ([first, others @ ..], [lowercase_first, lowercase_others @ ..]) => {
            *first == lowercase_first.to_ascii_uppercase() && others == lowercase_others
        }
        _ => false,
    };
    !lowercase_prefix.is_empty()
        && rest == suffix
        && (is_capitalized() || prefix == lowercase_prefix.to_ascii_uppercase())
}
