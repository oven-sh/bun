use bstr::ByteSlice;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Checks for arguments that are only used in recursion with no side effects.
pub struct OnlyUsedInRecursion;

const ONLY_USED_IN_RECURSION: Message = Message::new("", "Parameter `{{param_name}}` is only used in recursive calls");

#[derive(Default)]
pub struct State<'a> {
    /// The names under which the module exports something. Looked for when there is something to report.
    exported_bindings: Option<FxHashSet<Name<'a>>>,
}

impl Rule for OnlyUsedInRecursion {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "only-used-in-recursion", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        OnlyUsedInRecursion
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.funcs(|_, func, cx| {
            if !matches!(func.kind(), FnKind::Decl | FnKind::Expr | FnKind::Arrow) || !func.has_body() || func.params().is_empty() {
                return;
            }
            let Some(function) = function_symbol(func) else {
                return;
            };
            // Asked when a parameter is found.
            let mut known = None;
            let mut is_reassigned = || *known.get_or_insert_with(|| is_function_reassigned(function));
            let parameter_count = func.params().iter().filter(|it| !it.is_rest()).count();
            for (parameter_index, parameter) in func.params().iter().take(parameter_count).enumerate() {
                let pattern = parameter.pat();
                match pattern.kind() {
                    PatKind::Ident(_) => {
                        if let Some(symbol) = pattern.symbol()
                            && is_parameter_only_used_in_recursion(function, symbol, parameter_index)
                            && !is_reassigned()
                        {
                            let is_last = parameter_index + 1 == parameter_count;
                            report_parameter(cx, func, function, pattern, symbol, is_last.then_some(parameter_index));
                        }
                    }
                    PatKind::Object(properties) => {
                        for property in properties.iter().filter(|it| !it.is_rest()) {
                            if let Some(symbol) = property.value().symbol()
                                && let Some(name) = property.key().and_then(Key::name)
                                && is_jsx_property_only_used_in_recursion(symbol, name, function)
                                && !is_reassigned()
                            {
                                report_jsx_property(cx, function, property, symbol, name);
                            }
                        }
                    }
                    _ => {}
                }
            }
        });
        State::default()
    }
}

/// The variable that the function is the initializer of, or else what its name declares.
fn function_symbol(func: Func<'_>) -> Option<Symbol<'_>> {
    let declared = match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::VarDecl(declarator) if declarator.pat().tag() == PatTag::Ident => declarator.pat().symbol(),
            _ => None,
        },
        _ => None,
    };
    declared.or_else(|| func.symbol())
}

/// What oxlint has as the references to a symbol: not the name in a declaration with a value, nor the `a` of `a is T`.
fn symbol_references(symbol: Symbol<'_>) -> impl Iterator<Item = Reference<'_>> {
    symbol.references().filter(|it| {
        !it.is_jsx_pragma()
            && match it.node() {
                Node::Pat(_) => false,
                Node::Type(ty) => ty.tag() != TypeTag::Predicate,
                _ => true,
            }
    })
}

/// The call that the reference is directly in: as an argument, or as what is called.
fn call_around(reference: Reference<'_>) -> Option<(Expr<'_>, Call<'_>)> {
    let identifier = reference.expr().filter(|it| !it.is_parenthesized())?;
    let parent = identifier.parent().as_expr()?;
    Some((parent, parent.as_call()?))
}

impl<'a> State<'a> {
    fn is_exported(&mut self, function: Symbol<'a>) -> bool {
        self.exported_bindings.get_or_insert_with(|| exported_bindings(function.file())).contains(&function.name())
    }
}

fn exported_bindings<'a>(file: &'a File<'a>) -> FxHashSet<Name<'a>> {
    let mut names = FxHashSet::default();
    for statement in file.body() {
        match statement.kind() {
            StmtKind::ExportNamed(export) => names.extend(export.items().iter().map(|it| it.exported().name())),
            StmtKind::ExportStar { alias, .. } => names.extend(alias.map(Ident::name)),
            StmtKind::ImportEquals(import) if import.flags().contains(Flags::EXPORT) => {
                names.insert(import.name().name());
            }
            _ if !statement.is_exported() || statement.is_default_export() => {}
            StmtKind::Var(declarations) => {
                for declarator in declarations {
                    declarator.pat().for_each_binding(&mut |pat| names.extend(pat.as_ident()));
                }
            }
            StmtKind::Fn(func) => names.extend(func.name().map(Ident::name)),
            StmtKind::Class(class) => names.extend(class.name().map(Ident::name)),
            StmtKind::Interface(interface) => {
                names.insert(interface.name().name());
            }
            StmtKind::TypeAlias(alias) => {
                names.insert(alias.name().name());
            }
            StmtKind::Enum(declaration) => {
                names.insert(declaration.name().name());
            }
            StmtKind::Module(module) => {
                if let ModuleName::Ident(name) = module.name() {
                    names.insert(name.name());
                }
            }
            _ => {}
        }
    }
    names
}

/// `last_index`: the index of the parameter, if it is the last.
fn report_parameter<'a>(
    cx: &mut Cx<'a, OnlyUsedInRecursion>,
    func: Func<'a>,
    function: Symbol<'a>,
    parameter: Pat<'a>,
    symbol: Symbol<'a>,
    last_index: Option<usize>,
) {
    let fixable = last_index.filter(|_| !cx.state.is_exported(function));
    let report = cx.report(parameter, ONLY_USED_IN_RECURSION).data("param_name", symbol.name());
    let Some(parameter_index) = fixable else {
        return;
    };
    report.fix_dangerously(|fixer| {
        let mut fix = vec![delete_with_preceding_separator(fixer, parameter.span())];
        fix.extend(symbol_references(symbol).map(|it| delete_with_preceding_separator(fixer, it.span())));
        // The argument of the calls from elsewhere.
        let function_span = func.estree_span();
        for (call_expr, call) in symbol_references(function).filter_map(call_around) {
            if call.args().len() == parameter_index + 1
                && !function_span.contains(call_expr.span())
                && let Some(argument) = call.args().get(parameter_index)
            {
                fix.push(delete_with_preceding_separator(fixer, argument.outer_span()));
            }
        }
        fix
    });
}

fn report_jsx_property<'a>(
    cx: &mut Cx<'a, OnlyUsedInRecursion>,
    function: Symbol<'a>,
    property: PatProp<'a>,
    symbol: Symbol<'a>,
    property_name: Name<'a>,
) {
    let is_exported = cx.state.is_exported(function);
    let report = cx.report(property, ONLY_USED_IN_RECURSION).data("param_name", property_name);
    if is_exported {
        return;
    }
    report.fix_dangerously(|fixer| {
        // The property could also be in what is spread.
        if symbol_references(symbol).any(is_used_with_spread_attribute) {
            return None;
        }
        let mut fix = vec![delete_with_surrounding_separators(fixer, property.span())];
        fix.extend(symbol_references(symbol).filter_map(|it| jsx_attribute_around(it.node())).map(|it| fixer.remove(it)));
        Some(fix)
    });
}

/// The attributes of JSX elements that `node` is in, from the inside, those that are spread too.
fn jsx_attribute_items_around(node: Node<'_>) -> impl Iterator<Item = Prop<'_>> {
    node.ancestors().filter_map(|it| match it {
        Node::Prop(prop) if prop.is_jsx_attribute() => Some(prop),
        _ => None,
    })
}

fn jsx_attribute_around(node: Node<'_>) -> Option<Prop<'_>> {
    jsx_attribute_items_around(node).find(|it| it.kind() != PropKind::Spread)
}

fn jsx_element_of(attribute: Prop<'_>) -> Option<Jsx<'_>> {
    match attribute.parent().as_expr()?.kind() {
        ExprKind::Jsx(jsx) => Some(jsx),
        _ => None,
    }
}

fn is_used_with_spread_attribute(reference: Reference) -> bool {
    jsx_attribute_items_around(reference.node())
        .filter_map(jsx_element_of)
        .any(|element| element.attrs().iter().any(|it| it.kind() == PropKind::Spread))
}

fn is_parameter_only_used_in_recursion<'a>(function: Symbol<'a>, parameter: Symbol<'a>, parameter_index: usize) -> bool {
    let mut is_used = false;
    for reference in symbol_references(parameter) {
        is_used = true;
        let Some((_, call)) = call_around(reference) else {
            return false;
        };
        let Some(call_arg) = call.args().get(parameter_index) else {
            return false;
        };
        if call_arg.as_ident().is_some_and(|name| name != parameter.name()) && !call_arg.is_parenthesized() {
            return false;
        }
        let callee = call.callee();
        if callee.is_parenthesized() || callee.symbol() != Some(function) {
            return false;
        }
    }
    is_used
}

fn is_jsx_property_only_used_in_recursion<'a>(symbol: Symbol<'a>, property_name: Name<'a>, function: Symbol<'a>) -> bool {
    let mut is_used = false;
    for reference in symbol_references(symbol) {
        is_used = true;
        // It is all that is between the braces.
        let Some(identifier) = reference.expr().filter(|it| it.jsx_container_span().is_some() && !it.is_parenthesized()) else {
            return false;
        };
        let node = Node::Expr(identifier);
        // `a:b` is not an identifier.
        let is_same_name = |key: Key<'a>| {
            matches!(key.kind(), KeyKind::Ident(name) if name == property_name && !bun_core::strings::contains_char(name.bytes(), b':'))
        };
        if !jsx_attribute_around(node).and_then(Prop::key).is_some_and(is_same_name) {
            return false;
        }
        let element = jsx_attribute_items_around(node).next().and_then(jsx_element_of);
        if element.and_then(get_jsx_element_symbol) != Some(function) {
            return false;
        }
    }
    is_used
}

fn is_function_reassigned(function: Symbol) -> bool {
    function.has_modifying_references()
        && symbol_references(function).filter_map(Reference::expr).any(|identifier| {
            matches!(identifier.parent(), Node::Expr(parent)
                if parent.tag() == ExprTag::Assign && parent.left() == Some(identifier) && !parent.is_assignment_target())
        })
}

/// What the `A` of `<A>` and of `<A.b.c>` refers to. `<a>` refers to nothing.
fn get_jsx_element_symbol(element: Jsx<'_>) -> Option<Symbol<'_>> {
    let tag = element.tag()?;
    let mut identifier = tag;
    while let ExprKind::Dot { obj, .. } = identifier.kind() {
        identifier = obj;
    }
    let is_intrinsic = identifier == tag && identifier.as_ident()?.bytes().first().is_some_and(u8::is_ascii_lowercase);
    (!is_intrinsic).then(|| identifier.symbol()).flatten()
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || c == ','
}

/// Where the whitespace and the commas before `at` start.
fn skip_separators_back(text: &[u8], at: u32) -> u32 {
    let before = text.get(..at as usize).unwrap_or_default();
    before.char_indices().rev().take_while(|it| is_separator(it.2)).last().map_or(at, |it| it.0 as u32)
}

fn delete_with_preceding_separator(fixer: Fixer, span: Span) -> Fix {
    fixer.remove(Span::new(skip_separators_back(fixer.file().text(), span.start), span.end))
}

fn delete_with_surrounding_separators(fixer: Fixer, span: Span) -> Fix {
    let text = fixer.file().text();
    let after = text.get(span.end as usize..).unwrap_or_default();
    // Nothing more is deleted if the text ends with separators.
    let end = after.char_indices().find(|it| !is_separator(it.2)).map_or(span.end, |it| span.end + it.0 as u32);
    fixer.remove(Span::new(skip_separators_back(text, span.start), end))
}
