//! The nodes TypeScript's test harness writes a line for in `.types` and `.symbols` baselines (`typeWriterWalker.visitNode`).
//!
//! The harness goes through the syntax tree. The lowered tree has no node of its own for much of what is visited there, such as the
//! identifiers of `A.B.C` or a label. A [`VisitedNode`] says where such a node is written and what it belongs to in the lowered tree.

use super::enclosing_declaration::or_file_scope;
use super::*;
use crate::bind::{Decl, MemberOwner, Parent, ScopeId, SymbolId};

/// A node `visitNode` takes.
#[derive(Copy, Clone, Debug)]
pub(super) struct VisitedNode {
    /// `SkipTrivia(text, node.Pos())`
    pub(super) start: u32,
    /// `node.End()`
    pub(super) end: u32,
    pub(super) kind: VisitedKind,
}

/// What a visited node is in the lowered tree.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum VisitedKind {
    /// An expression of the lowered tree, without the parentheses around it.
    Expression(ExprId),
    /// A `ParenthesizedExpression` around it: which one, counted from the outermost.
    Parenthesized(ExprId, u32),
    /// The `b` of `a.b`, the `target` of `new.target`, the `meta` of `import.meta`.
    AccessName(ExprId),
    /// An identifier where the string of `import a = require("m")` or `export * from "m"` must be, which is in no expression
    /// context.
    ModuleSpecifier(ExprId),
    /// The `defer` of `import.defer("m")`.
    ImportDeferName(ExprId),
    /// The `const` of `x as const` and of `<const>x`.
    ConstOfAsConst(ExprId),
    /// The name of an intrinsic element in a tag of the JSX element, and the string the lowered tree keeps for it.
    JsxIntrinsicTagName(ExprId, ExprId),
    /// One of the two identifiers of a `JsxNamespacedName`.
    JsxNamespacedNamePart,
    /// The name of a declaration, and the symbol of the declaration.
    DeclarationName(Decl, SymbolId),
    /// The `a` of `import { a as b }` and of `export { a as b }`, with the specifier and its symbol.
    SpecifierPropertyName(Decl, SymbolId),
    /// Of a class, an interface or a type literal.
    MemberName(MemberId),
    /// The name of a property of an object literal, or of a JSX attribute.
    PropertyName(PropId),
    ImportAttributeName(PropId),
    /// The name a variable, a parameter or a binding element declares.
    BindingName(PatId),
    /// The `a` of `{ a: b }` in a binding pattern.
    BindingPropertyName(PatPropId),
    ThisParameter(FnId),
    /// The `"a"` of the member name `["a"]`, the `0` of `[0]`.
    LiteralInMemberName(MemberId),
    /// The same in an object literal.
    LiteralInPropertyName(PropId),
    /// The same in an object binding pattern.
    LiteralInBindingPropertyName(PatPropId),
    /// The same in an enum.
    LiteralInEnumMemberName(EnumMemberId),
    /// `true`, `false` or `-1` right under a `LiteralType`.
    LiteralType(TypeNodeId),
    /// The `1` of that `-1`.
    LiteralTypeOperand(TypeNodeId),
    /// By its index in `hir::File::directives`.
    Directive(u32),
    /// Of a labeled statement, a `break` or a `continue`.
    Label(StmtId),
    /// The identifier at an index in the `A.B.C` of a type reference.
    TypeReferenceName(TypeNodeId, u32),
    /// The identifier at an index in the `A.B.C` of `implements A.B.C`, or of the `extends A.B.C` of an interface. The lowered tree
    /// keeps a type reference there. It is an `ExpressionWithTypeArguments` (`parseHeritageClause`).
    HeritageClauseName(TypeNodeId, u32),
    /// The property access in it that ends with the identifier at an index: `A.B`, `A.B.C`.
    HeritageClausePropertyAccess(TypeNodeId, u32),
    /// The identifier at an index in the `A.B` of `import("m").A.B`.
    ImportTypeQualifierName(TypeNodeId, u32),
    /// The identifier at an index in the `a.b` of `import x = a.b`.
    ImportEqualsName(ImportEqualsId, u32),
    /// The `x` of `x is T` and of `asserts x`.
    TypePredicateParameter(TypeNodeId),
}

/// What stands, without parentheses, where the module specifier of an import or an export goes and is no string literal.
fn module_specifier_expressions(hir: &File) -> impl Iterator<Item = ExprId> + '_ {
    let required = hir.import_equals.iter().map(|import| import.expression);
    required
        .chain(hir.specifier_expressions.iter().copied())
        .filter(|&e| e.is_some() && !is_parenthesized(hir, e))
}

impl Checker<'_> {
    /// `typeWriterWalker.visitNode` over `forEachASTNode`.
    pub(super) fn visited_nodes(&self, file: FileId) -> Vec<VisitedNode> {
        let hir = self.hir(file);
        let mut visitor = Visitor {
            c: self,
            file,
            hir,
            nodes: Vec::with_capacity(hir.exprs.len() * 2),
        };
        visitor.expressions();
        visitor.declarations();
        visitor.names();
        visitor.statements();
        visitor.type_nodes();
        // `forEachASTNode` leaves out what is reparsed from a JSDoc comment, and a comment is no child of a node.
        visitor.nodes.retain(|node| !hir.is_in_jsdoc(node.start));
        // It goes down from the file. Of two expressions of one extent the one around the other was made later.
        visitor.nodes.sort_by_key(|node| {
            let made = match node.kind {
                VisitedKind::Expression(e) => e.0,
                _ => 0,
            };
            // Where the parser missed a name and an expression at one place, the name comes first: the clause of an import stands
            // before its specifier.
            let is_missing_expression =
                node.start == node.end && matches!(node.kind, VisitedKind::Expression(_));
            (
                node.start,
                std::cmp::Reverse(node.end),
                is_missing_expression,
                std::cmp::Reverse(made),
            )
        });
        visitor.nodes
    }

    /// `node.Parent`, as the scope names are looked up from when a type or a symbol is written for the node.
    pub(super) fn enclosing_scope_of_visited_node(
        &self,
        file: FileId,
        kind: VisitedKind,
    ) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e)
            | VisitedKind::ModuleSpecifier(e)
            | VisitedKind::ImportDeferName(e)
            | VisitedKind::ConstOfAsConst(e)
            | VisitedKind::JsxIntrinsicTagName(e, _) => self.enclosing_scope_of_expr(file, e),
            VisitedKind::DeclarationName(decl, _) | VisitedKind::SpecifierPropertyName(decl, _) => {
                self.enclosing_scope_of_declaration(file, decl)
            }
            VisitedKind::BindingName(pat) => self.enclosing_scope_of_pat(file, pat),
            VisitedKind::LiteralInBindingPropertyName(p) | VisitedKind::BindingPropertyName(p)
                if hir[p].value.is_some() =>
            {
                self.enclosing_scope_of_pat(file, hir[p].value)
            }
            VisitedKind::ThisParameter(f) => self.enclosing_scope_of_declaration(file, Decl::Fn(f)),
            VisitedKind::LiteralInEnumMemberName(m) => {
                self.enclosing_scope_of_declaration(file, Decl::EnumMember(m))
            }
            VisitedKind::LiteralInMemberName(m) | VisitedKind::MemberName(m) => {
                self.enclosing_scope_of_member(file, m)
            }
            VisitedKind::LiteralInPropertyName(p)
            | VisitedKind::PropertyName(p)
            | VisitedKind::ImportAttributeName(p) => self.enclosing_scope_of_property(file, p),
            VisitedKind::LiteralType(node)
            | VisitedKind::LiteralTypeOperand(node)
            | VisitedKind::TypeReferenceName(node, _)
            | VisitedKind::HeritageClauseName(node, _)
            | VisitedKind::HeritageClausePropertyAccess(node, _)
            | VisitedKind::ImportTypeQualifierName(node, _)
            | VisitedKind::TypePredicateParameter(node) => {
                or_file_scope(bound.type_scope[node.idx()])
            }
            VisitedKind::ImportEqualsName(import, _) => {
                self.enclosing_scope_of_declaration(file, Decl::ImportEquals(import))
            }
            VisitedKind::Label(s) => or_file_scope(bound.stmt_scope[s.idx()]),
            VisitedKind::LiteralInBindingPropertyName(_)
            | VisitedKind::BindingPropertyName(_)
            | VisitedKind::JsxNamespacedNamePart
            | VisitedKind::Directive(_) => ScopeId(0),
        }
    }
}

struct Visitor<'c, 'p> {
    c: &'c Checker<'p>,
    file: FileId,
    hir: &'p File,
    nodes: Vec<VisitedNode>,
}

impl Visitor<'_, '_> {
    /// Takes the node from `start` to `end`, unless nothing is written there.
    fn node(&mut self, start: u32, end: u32, kind: VisitedKind) {
        if start < end {
            self.nodes.push(VisitedNode { start, end, kind });
        }
    }

    /// Takes the token at `start`.
    fn token(&mut self, start: u32, kind: VisitedKind) {
        self.node(start, self.c.end_of_token_at(self.file, start), kind);
    }

    /// Takes the name at `start`: an identifier, a private name, a string, a number, `[computed]`.
    fn name(&mut self, start: u32, kind: VisitedKind) {
        self.node(start, self.c.end_of_name_at(self.file, start), kind);
    }

    /// Takes the name of a declaration, which is at `start`.
    fn name_of(&mut self, is_missing: bool, start: u32, kind: VisitedKind) {
        if is_missing {
            self.missing_identifier(start, kind);
        } else {
            self.name(start, kind);
        }
    }

    /// Takes the two identifiers of the `JsxNamespacedName` from `start` to `end`. Returns whether it is one.
    fn jsx_namespaced_name(&mut self, start: u32, end: u32) -> bool {
        let written = self.hir.text.get(start as usize..end as usize);
        let Some(colon) = written.and_then(|name| name.iter().position(|&b| b == b':')) else {
            return false;
        };
        let colon = start + colon as u32;
        let namespace_end = self.c.end_of_token_before(self.file, colon);
        self.node(start, namespace_end, VisitedKind::JsxNamespacedNamePart);
        let name = self.skip_trivia(colon + 1);
        if name < end {
            self.node(name, end, VisitedKind::JsxNamespacedNamePart);
        } else {
            self.missing_identifier(colon + 1, VisitedKind::JsxNamespacedNamePart);
        }
        true
    }

    /// `createMissingNode`: an identifier the parser missed at `pos` is a node without text, where the token before it ends. The
    /// harness puts it on the line of the token after it (`SkipTrivia`).
    fn missing_identifier(&mut self, pos: u32, kind: VisitedKind) {
        // `parseThrowStatement` alone reports nothing for the identifier it misses.
        let is_thrown = matches!(kind, VisitedKind::Expression(e)
            if matches!(self.c.bound(self.file).expr_parent[e.idx()], Parent::Stmt(s)
                if matches!(self.hir[s].kind, StmtKind::Throw(_))));
        if self.hir.has_parse_diagnostics || is_thrown {
            let start = self.skip_trivia(self.c.end_of_token_before(self.file, pos));
            let end = start;
            self.nodes.push(VisitedNode { start, end, kind });
        }
    }

    /// Whether `name`, which is written at `start`, is an identifier the parser missed. `""` and `[""]` are names.
    fn is_missing(&self, name: Atom, start: u32) -> bool {
        let first = self.hir.text.get(start as usize);
        name == known::empty && !matches!(first, Some(b'"' | b'\'' | b'['))
    }

    /// Takes the identifiers of the entity name `names`, which is written at `start`.
    fn entity_name(&mut self, start: u32, names: IdList<Atom>, kind: impl Fn(u32) -> VisitedKind) {
        let (mut start, mut names, mut first) = (start, names, 0);
        // `parseEntityName`: a first name that is missing is where the dot is.
        if names.len() > 1 && self.hir.id_at(names, 0) == known::empty {
            self.missing_identifier(start, kind(0));
            start = self.skip_trivia(self.skip_trivia(start) + 1);
            names = IdList::new(names.start + 1, names.len - 1);
            first = 1;
        }
        let ranges = self.c.entity_name_ranges(self.file, start, names);
        // `parseRightSideOfDot`
        if let Some(&(_, end)) = ranges.last().filter(|_| ranges.len() < names.len()) {
            let position = first + ranges.len() as u32;
            self.missing_identifier(self.skip_trivia(end) + 1, kind(position));
        }
        for (position, (start, end)) in (first..).zip(ranges) {
            self.node(start, end, kind(position));
        }
    }

    fn is_written_at(&self, pos: u32, word: &[u8]) -> bool {
        let rest = self.hir.text.get(pos as usize..);
        rest.is_some_and(|rest| rest.starts_with(word))
    }

    fn skip_trivia(&self, pos: u32) -> u32 {
        self.c.skip_trivia_from(self.file, pos)
    }

    /// Where the token after the one at `pos` starts.
    fn token_after(&self, pos: u32) -> u32 {
        self.skip_trivia(self.c.end_of_token_at(self.file, pos))
    }

    /// Where the name of a `MetaProperty` starts whose keyword is at `pos`.
    fn meta_property_name(&self, pos: u32) -> Option<u32> {
        let dot = self.token_after(pos);
        (self.hir.text.get(dot as usize) == Some(&b'.')).then(|| self.skip_trivia(dot + 1))
    }

    fn expressions(&mut self) {
        let (hir, file) = (self.hir, self.file);
        let bound = self.c.bound(file);
        let is_not_visited = self.expressions_not_visited();
        for index in 0..hir.exprs.len() {
            if is_not_visited[index] {
                continue;
            }
            let e = ExprId(index as u32);
            let expr = hir[e];
            match expr.kind {
                ExprKind::Missing | ExprKind::Ident(known::empty) => {
                    self.missing_identifier(expr.pos, VisitedKind::Expression(e));
                    continue;
                }
                // A `PrivateIdentifier` is an expression node only as the left operand of `in`.
                ExprKind::String(_) if is_private_name_at(hir, expr.pos) => {
                    let is_left_of_in = !is_parenthesized(hir, e)
                        && matches!(bound.expr_parent[index], Parent::Expr(parent)
                            if matches!(hir[parent].kind, ExprKind::Binary { op: BinOp::In, left, .. } if left == e));
                    if !is_left_of_in {
                        continue;
                    }
                }
                ExprKind::Dot {
                    name: known::empty,
                    name_pos,
                    ..
                } => self.missing_identifier(name_pos, VisitedKind::AccessName(e)),
                // The `#b` of `a.#b` is neither an identifier nor an expression node.
                ExprKind::Dot { name_pos, .. } if !is_private_name_at(hir, name_pos) => {
                    self.token(name_pos, VisitedKind::AccessName(e));
                }
                ExprKind::ImportMeta | ExprKind::NewTarget(_) => {
                    if let Some(name) = self.meta_property_name(expr.pos) {
                        self.token(name, VisitedKind::AccessName(e));
                    }
                }
                ExprKind::ImportCall { args, .. }
                    if hir
                        .deferred_import_calls
                        .iter()
                        .any(|call| call.0 == hir.id_at(args, 0)) =>
                {
                    if let Some(name) = self.meta_property_name(expr.pos) {
                        self.token(name, VisitedKind::ImportDeferName(e));
                    }
                }
                ExprKind::AsConst(operand) => {
                    let start = if expr.pos < self.c.start_of(file, operand) {
                        self.skip_trivia(expr.pos + 1)
                    } else {
                        self.token_after(self.skip_trivia(self.c.end_of_expr(file, operand)))
                    };
                    if self.is_written_at(start, b"const") {
                        self.node(start, start + 5, VisitedKind::ConstOfAsConst(e));
                    }
                }
                ExprKind::Jsx(jsx) if bound.expr_scope.contains_key(&e) => {
                    let jsx = hir[jsx];
                    for tag in [jsx.tag, jsx.close_tag] {
                        if tag.is_none() || self.c.jsx_intrinsic_tag_name(file, tag).is_none() {
                            continue;
                        }
                        let start = hir[tag].pos;
                        let end = jsx_tag_name_end(&hir.text, start as usize) as u32;
                        if !self.jsx_namespaced_name(start, end) {
                            self.node(start, end, VisitedKind::JsxIntrinsicTagName(e, tag));
                        }
                    }
                }
                _ => {}
            }
            let mut start = self.c.start_inside_parentheses(file, e);
            // `GetSourceTextOfNodeFromSourceFile`: what starts with an identifier the parser missed starts at the next token.
            if hir.has_parse_diagnostics {
                start = self.skip_trivia(start);
            }
            let end = self.c.end_inside_parentheses(file, e);
            self.node(start, end, VisitedKind::Expression(e));
        }
        for &(e, outermost) in &hir.parens {
            if is_not_visited[e.idx()] {
                continue;
            }
            // The type of a `satisfies` that is reparsed from a tag is written before the parenthesis.
            let is_reparsed_satisfies = matches!(hir[e].kind, ExprKind::Satisfies { ty, .. }
                if ty.is_some() && hir.is_in_jsdoc(hir[ty].pos));
            let inside = self.c.start_inside_parentheses(file, e);
            let mut open = outermost;
            for depth in 0.. {
                if open >= inside || hir.text.get(open as usize) != Some(&b'(') {
                    break;
                }
                let end = if is_reparsed_satisfies {
                    self.c.end_of_bracket_at(file, open)
                } else {
                    self.c.end_of_expr_from(file, e, open)
                };
                self.node(open, end, VisitedKind::Parenthesized(e, depth));
                open = self.skip_trivia(open + 1);
            }
        }
    }

    /// The expressions of the lowered tree that stand for no node, or for one `visitNode` does not take.
    fn expressions_not_visited(&self) -> Vec<bool> {
        let hir = self.hir;
        // `IsExpressionNode`: these go by `IsInExpressionContext`.
        let is_literal = |e: ExprId| match hir[e].kind {
            ExprKind::String(_) | ExprKind::Number(_) | ExprKind::BigInt(_) | ExprKind::This => {
                true
            }
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            _ => false,
        };
        let is_missing = |e: &ExprId| {
            matches!(
                hir[*e].kind,
                ExprKind::Missing | ExprKind::Ident(known::empty)
            )
        };
        let mut not_visited: Vec<ExprId> = Vec::new();
        // What is missing without being an identifier the parser missed.
        let mut not_missed: Vec<ExprId> = Vec::new();
        // `Base<T>` after `extends` is no expression node. What the lowering first made of it is still among the expressions.
        let mut is_extended = vec![false; hir.exprs.len()];
        for class in &hir.classes {
            if class.extends.is_some() {
                is_extended[class.extends.idx()] = true;
            }
        }
        for (index, expr) in hir.exprs.iter().enumerate() {
            match expr.kind {
                ExprKind::Instantiation { expr, .. } if is_extended[expr.idx()] => {
                    not_visited.push(ExprId(index as u32));
                }
                // An `OmittedExpression`
                ExprKind::Array(items) => not_missed.extend(hir.ids(items)),
                // `parseDecoratedExpression`: decorators before what is no class make a `MissingDeclaration`.
                ExprKind::Missing if hir.text.get(expr.pos as usize) == Some(&b'@') => {
                    not_missed.push(ExprId(index as u32));
                }
                // The keyword of a `MetaProperty` is no node.
                ExprKind::Dot { obj, .. }
                    if matches!(hir[obj].kind, ExprKind::Missing)
                        && hir
                            .text
                            .get(hir[obj].pos as usize..)
                            .is_some_and(|text| text.starts_with(b"import")) =>
                {
                    not_missed.push(obj);
                }
                _ => {}
            }
        }
        // A shorthand property is one node, which is visited as a name. A method or an accessor is a declaration: the function
        // expression that stands for it is no node.
        not_visited.extend(hir.props.iter().filter_map(|prop| {
            matches!(
                prop.kind,
                PropKind::Shorthand | PropKind::Method | PropKind::Getter | PropKind::Setter
            )
            .then_some(prop.value)
        }));
        // `{ a = 1 } = o`: the value is an assignment to the name.
        not_visited.extend(hir.props.iter().filter_map(|prop| {
            match hir.exprs.get(prop.value.idx())?.kind {
                ExprKind::Assign { target, .. } if prop.kind == PropKind::Shorthand => Some(target),
                _ => None,
            }
        }));
        // `IsInExpressionContext` does not hold right under an `ExportAssignment`. The one statement of a JSON file is an
        // `ExpressionStatement`, which is kept as `export =`.
        not_visited.extend(hir.stmts.iter().filter_map(|stmt| match stmt.kind {
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)
                if e.is_some()
                    && hir.kind != FileKind::Json
                    && !is_parenthesized(hir, e)
                    && is_literal(e) =>
            {
                Some(e)
            }
            _ => None,
        }));
        // Nor is what stands for a module specifier: an identifier is visited as that, a literal not at all.
        not_visited.extend(
            module_specifier_expressions(hir)
                .filter(|&e| is_literal(e) || matches!(hir[e].kind, ExprKind::Ident(_))),
        );
        // `ImportAttributes` is no expression node, and the value of an `ImportAttribute` is in no expression context.
        for &(_, attributes) in hir.import_attributes.iter() {
            not_visited.push(attributes);
            if let ExprKind::Object(props) = hir[attributes].kind {
                let values = props.iter().map(|p| hir[p].value);
                not_visited.extend(values.filter(|&value| value.is_some() && is_literal(value)));
            }
        }
        for jsx in hir.jsx.iter() {
            let values = || {
                jsx.attrs
                    .iter()
                    .map(|p| hir[p].value)
                    .filter(|e| e.is_some())
            };
            // The empty `{}` of `name={}`, which the parser puts where the brace is. It makes no child of one.
            let is_at_brace = |e: &ExprId| hir.text.get(hir[*e].pos as usize) == Some(&b'{');
            not_missed.extend(values().filter(is_at_brace));
            // `VisitedKind::JsxIntrinsicTagName`
            not_visited.extend([jsx.tag, jsx.close_tag].into_iter().filter(|&tag| {
                tag.is_some() && self.c.jsx_intrinsic_tag_name(self.file, tag).is_some()
            }));
            // `JsxText`, which is put where its element starts, and `{...children}`, which is no `SpreadElement`.
            not_visited.extend(
                hir.ids(jsx.children)
                    .filter(|&child| match hir[child].kind {
                        ExprKind::String(_) => hir.text.get(hir[child].pos as usize) == Some(&b'<'),
                        ExprKind::Spread(_) => true,
                        _ => false,
                    }),
            );
            // The string of `name="value"`, not of `name={"value"}`, is in no expression context.
            not_visited.extend(values().filter(|&value| {
                let before = self.c.end_of_token_before(self.file, hir[value].pos) as usize;
                matches!(hir[value].kind, ExprKind::String(_))
                    && before > 0
                    && hir.text.get(before - 1) == Some(&b'=')
            }));
        }
        // What nothing leads to is no node: the parser made it in an attempt it gave up.
        let parents = self.c.bound(self.file).expr_parent.iter();
        let mut is_not_visited: Vec<bool> = parents.map(|p| matches!(p, Parent::None)).collect();
        // An identifier the parser missed is visited wherever the lowered tree has it.
        let not_visited = not_visited
            .into_iter()
            .filter(|e| e.is_some() && !is_missing(e));
        let not_missed = not_missed
            .into_iter()
            .filter(|e| e.is_some() && is_missing(e));
        for e in not_visited.chain(not_missed) {
            is_not_visited[e.idx()] = true;
        }
        is_not_visited
    }

    /// The names of the declarations that are in the table of symbols of the file.
    fn declarations(&mut self) {
        let (hir, file) = (self.hir, self.file);
        let bound = self.c.bound(file);
        // `declareSymbolEx`: `Symbol::decls` also lists the declarations the symbol refused. Each has a symbol of its own, made later.
        let mut symbols: FxHashMap<Decl, SymbolId> = FxHashMap::default();
        for (index, symbol) in bound.symbols.iter().enumerate() {
            // `cloneSymbol` copies the declarations, whose `Symbol` is still what the binder made.
            if symbol.flags.contains(SymFlags::TRANSIENT) {
                continue;
            }
            let id = SymbolId(index as u32);
            symbols.extend(symbol.decls.iter().map(|&decl| (decl, id)));
        }
        for (index, symbol) in bound.symbols.iter().enumerate() {
            let id = SymbolId(index as u32);
            let is_symbol_of = |decl: &&Decl| match bound.symbol_of_declaration(**decl) {
                SymbolId::NONE => symbols[*decl] == id,
                own => own == id,
            };
            for &decl in symbol.decls.iter().filter(is_symbol_of) {
                let (name, start) = match decl {
                    // A method is visited with the other members.
                    Decl::Fn(f) if matches!(hir[f].kind, FnKind::Decl | FnKind::Expr) => {
                        (hir[f].name, hir[f].name_pos)
                    }
                    Decl::Class(c) => (hir[c].name, hir[c].name_pos),
                    Decl::Interface(i) => (hir[i].name, hir[i].name_pos),
                    Decl::Alias(a) => (hir[a].name, hir[a].name_pos),
                    Decl::Enum(e) => (hir[e].name, hir[e].name_pos),
                    Decl::EnumMember(m) => (hir[m].name, hir[m].pos),
                    Decl::TypeParam(p) => (hir[p].name, hir[p].pos),
                    Decl::Module(m) => (symbol.name, hir[m].name_pos),
                    Decl::ImportDefault(i) => (hir[i].default, hir[i].default_pos),
                    Decl::ImportNamespace(i) => (hir[i].namespace, hir[i].namespace_pos),
                    Decl::ImportEquals(i) => (hir[i].name, hir[i].name_pos),
                    Decl::ImportSpec(s) => (hir[s].local, hir[s].pos),
                    Decl::ExportSpec(s) => (hir[s].exported, hir[s].pos),
                    Decl::ExportStarAs(_) | Decl::UmdGlobal(_) => {
                        match self.c.declaration_name_start(file, decl) {
                            Some(start) => (symbol.name, start),
                            None => continue,
                        }
                    }
                    // Variables and parameters are patterns.
                    _ => continue,
                };
                if let Decl::EnumMember(m) = decl {
                    let kind = VisitedKind::LiteralInEnumMemberName(m);
                    self.literal_in_computed_name(PropKey::Name(name), start, kind);
                }
                // `[e]` names nothing.
                if name.is_some() || matches!(decl, Decl::EnumMember(_)) {
                    let is_missing = self.is_missing(name, start);
                    self.name_of(is_missing, start, VisitedKind::DeclarationName(decl, id));
                }
                // The `PropertyName` of a specifier is visited only if it is an identifier.
                let property_name = match decl {
                    Decl::ImportSpec(s) => hir[s].imported_pos,
                    Decl::ExportSpec(s) => hir[s].local_pos,
                    _ => start,
                };
                if property_name != start
                    && !matches!(hir.text.get(property_name as usize), Some(b'"' | b'\''))
                {
                    self.name(property_name, VisitedKind::SpecifierPropertyName(decl, id));
                }
            }
        }
        // `bindNamespaceExportDeclaration` gives `export as namespace N` a symbol only at the top of a module.
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let decl = Decl::UmdGlobal(StmtId(index as u32));
            if matches!(stmt.kind, StmtKind::ExportAsNamespace(_))
                && !symbols.contains_key(&decl)
                && let Some(start) = self.c.declaration_name_start(file, decl)
            {
                self.name(start, VisitedKind::DeclarationName(decl, SymbolId::NONE));
            }
        }
    }

    /// The names of members and properties, those in patterns, parameter lists and `import x = a.b`, and the literals in computed
    /// names.
    fn names(&mut self) {
        let (hir, file) = (self.hir, self.file);
        let bound = self.c.bound(file);
        for (index, pat) in hir.pats.iter().enumerate() {
            // What nothing leads to is no node. The name of a `this` parameter is visited with its function.
            if matches!(bound.pat_parent[index], crate::bind::PatParent::None) {
                continue;
            }
            let kind = VisitedKind::BindingName(PatId(index as u32));
            match pat.kind {
                PatKind::Ident(known::empty) => self.missing_identifier(pat.pos, kind),
                PatKind::Ident(_) => self.token(pat.pos, kind),
                _ => {}
            }
        }
        for (index, prop) in hir.pat_props.iter().enumerate() {
            let p = PatPropId(index as u32);
            let kind = VisitedKind::LiteralInBindingPropertyName(p);
            self.literal_in_computed_name(prop.key, prop.key_pos, kind);
            // In `{ a }` the one identifier is the name that is bound. A string or a number is no identifier.
            let is_identifier = hir.text.get(prop.key_pos as usize).is_some_and(|&first| {
                first.is_ascii_alphabetic() || matches!(first, b'_' | b'$' | b'\\') || first >= 0x80
            });
            if matches!(prop.key, PropKey::Name(name) if self.is_missing(name, prop.key_pos)) {
                self.missing_identifier(prop.key_pos, VisitedKind::BindingPropertyName(p));
            } else if matches!(prop.key, PropKey::Name(_))
                && is_identifier
                && prop.value.is_some()
                && hir[prop.value].pos != prop.key_pos
            {
                self.token(prop.key_pos, VisitedKind::BindingPropertyName(p));
            }
        }
        // A name that names nothing (`getDeclarationName`) is kept as no name, as is one the parser missed: `#x` with no class
        // around it, `1n`.
        let is_missing = |key: PropKey, start: u32| match (key, hir.text.get(start as usize)) {
            (PropKey::None, first) => !matches!(first, Some(b'#' | b'0'..=b'9')),
            (PropKey::Name(known::empty), first) => !matches!(first, Some(b'"' | b'\'' | b'[')),
            _ => false,
        };
        let mut import_attributes: Vec<ExprId> =
            hir.import_attributes.iter().map(|of| of.1).collect();
        import_attributes.sort_unstable();
        for (index, prop) in hir.props.iter().enumerate() {
            let p = PropId(index as u32);
            self.literal_in_computed_name(
                prop.key,
                prop.pos,
                VisitedKind::LiteralInPropertyName(p),
            );
            if matches!(prop.kind, PropKind::Spread) {
                continue;
            }
            let end = self.c.end_of_prop_name(file, p);
            if is_missing(prop.key, prop.pos) {
                self.missing_identifier(prop.pos, VisitedKind::PropertyName(p));
            } else if import_attributes
                .binary_search(&bound.prop_owner[index])
                .is_err()
            {
                self.node(prop.pos, end, VisitedKind::PropertyName(p));
                let owner = bound.prop_owner[index];
                if owner.is_some() && matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                    self.jsx_namespaced_name(prop.pos, end);
                }
            // The name of an `ImportAttribute` is no declaration name: a string literal there is not visited.
            } else if !matches!(hir.text.get(prop.pos as usize), Some(b'"' | b'\'')) {
                self.node(prop.pos, end, VisitedKind::ImportAttributeName(p));
            }
        }
        for (index, member) in hir.members.iter().enumerate() {
            let m = MemberId(index as u32);
            let start = hir[m].name_pos;
            self.literal_in_computed_name(member.key, start, VisitedKind::LiteralInMemberName(m));
            if matches!(
                member.kind,
                MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
            ) && bound.member_owner[index] != MemberOwner::None
            {
                self.name_of(
                    is_missing(member.key, start),
                    start,
                    VisitedKind::MemberName(m),
                );
            }
        }
        for (index, function) in hir.fns.iter().enumerate() {
            // What the reparser makes of a tag is no node of the file.
            if let Some(this) = hir.params.get(function.this_param.idx())
                && !this.flags.contains(Flags::REPARSED)
            {
                let start = hir[this.pat].pos;
                self.node(
                    start,
                    start + 4,
                    VisitedKind::ThisParameter(FnId(index as u32)),
                );
            }
        }
        for specifier in module_specifier_expressions(hir) {
            if matches!(hir[specifier].kind, ExprKind::Ident(_)) {
                self.token(hir[specifier].pos, VisitedKind::ModuleSpecifier(specifier));
            }
        }
        for (index, import) in hir.import_equals.iter().enumerate() {
            let id = ImportEqualsId(index as u32);
            if let ImportEqualsTarget::Entity(entity) = import.target
                && let Some(start) = self.c.start_of_import_equals_reference(file, id)
            {
                if hir.ids(entity).eq([known::empty]) {
                    self.missing_identifier(start, VisitedKind::ImportEqualsName(id, 0));
                } else {
                    self.entity_name(start, entity, |at| VisitedKind::ImportEqualsName(id, at));
                }
            }
        }
    }

    /// The string or number of `["a"]` and `[0]`, whose `[` is at `bracket`. The lowered tree keeps it as the name `key` alone.
    /// `IsInExpressionContext`: it is the expression of a `ComputedPropertyName`.
    fn literal_in_computed_name(&mut self, key: PropKey, bracket: u32, kind: VisitedKind) {
        let text = &self.hir.text;
        if !matches!(key, PropKey::Name(_)) || text.get(bracket as usize) != Some(&b'[') {
            return;
        }
        let start = self.skip_trivia(bracket + 1);
        if matches!(
            text.get(start as usize),
            Some(b'"' | b'\'' | b'`' | b'0'..=b'9' | b'.')
        ) {
            self.token(start, kind);
        }
    }

    /// Labels, and directives, which are `ExpressionStatement`s of a string literal.
    fn statements(&mut self) {
        let hir = self.hir;
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let start = match stmt.kind {
                StmtKind::Labeled { .. } => stmt.pos,
                StmtKind::Break(known::empty) | StmtKind::Continue(known::empty) => {
                    let keyword_end = self.c.end_of_token_at(self.file, stmt.pos);
                    self.missing_identifier(keyword_end, VisitedKind::Label(StmtId(index as u32)));
                    continue;
                }
                StmtKind::Break(label) | StmtKind::Continue(label) if label.is_some() => {
                    self.token_after(stmt.pos)
                }
                _ => continue,
            };
            self.token(start, VisitedKind::Label(StmtId(index as u32)));
        }
        for (index, &(start, _)) in hir.directives.iter().enumerate() {
            self.token(start, VisitedKind::Directive(index as u32));
        }
    }

    /// The identifiers of entity names in types, and the expression nodes under a `LiteralType`.
    fn type_nodes(&mut self) {
        let (hir, file) = (self.hir, self.file);
        let classes = hir.classes.iter();
        let implemented = classes.flat_map(|class| [class.implements, class.other_implements]);
        let interfaces = hir.interfaces.iter();
        let extended = interfaces.flat_map(|i| [i.extends, i.other_heritage]);
        let mut heritage: Vec<TypeNodeId> = implemented
            .chain(extended)
            .flat_map(|clause| hir.ids(clause))
            .collect();
        heritage.sort_unstable();
        for index in 0..hir.types.len() {
            let node = TypeNodeId(index as u32);
            let start = hir[node].pos;
            match hir[node].kind {
                TypeNodeKind::Ref { name, .. } if heritage.binary_search(&node).is_ok() => {
                    let ranges = self.c.entity_name_ranges(file, start, name);
                    for (position, (from, end)) in (0..).zip(ranges) {
                        self.node(from, end, VisitedKind::HeritageClauseName(node, position));
                        if position > 0 {
                            let kind = VisitedKind::HeritageClausePropertyAccess(node, position);
                            self.node(start, end, kind);
                        }
                    }
                }
                TypeNodeKind::Ref { name, .. }
                    if !hir.is_in_jsdoc(start) && hir.ids(name).eq([known::empty]) =>
                {
                    self.missing_identifier(start, VisitedKind::TypeReferenceName(node, 0));
                }
                // A `QualifiedName` is neither an expression node nor an identifier.
                TypeNodeKind::Ref { name, .. } => {
                    self.entity_name(start, name, |at| VisitedKind::TypeReferenceName(node, at));
                }
                TypeNodeKind::Predicate { param, asserts, .. } if param != known::this => {
                    let start = if asserts && self.is_written_at(start, b"asserts") {
                        self.token_after(start)
                    } else {
                        start
                    };
                    self.name(start, VisitedKind::TypePredicateParameter(node));
                }
                TypeNodeKind::Import { name, .. } if !name.is_empty() => {
                    if let Some(start) = self.c.start_of_import_type_qualifier(file, node) {
                        let kind = |at| VisitedKind::ImportTypeQualifierName(node, at);
                        self.entity_name(start, name, kind);
                    }
                }
                // `IsExpressionNode` goes by the kind alone for `true`, `false` and a `PrefixUnaryExpression`, and the operand of
                // the `-` is in an expression context.
                TypeNodeKind::BoolLit(_) => self.token(start, VisitedKind::LiteralType(node)),
                TypeNodeKind::NumberLit(_) | TypeNodeKind::BigIntLit { .. }
                    if hir.text.get(start as usize) == Some(&b'-') =>
                {
                    let end = self.c.end_of_type_node(file, node);
                    self.node(start, end, VisitedKind::LiteralType(node));
                    let operand = self.skip_trivia(start + 1);
                    self.node(operand, end, VisitedKind::LiteralTypeOperand(node));
                }
                _ => {}
            }
        }
    }
}
