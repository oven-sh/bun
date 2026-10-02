//! The nodes TypeScript's test harness writes a line for in `.types` and `.symbols` baselines (`typeWriterWalker.visitNode`).
//!
//! The harness goes through the syntax tree. The lowered tree has no node of its own for much of what is visited there, such as the
//! identifiers of `A.B.C` or a label. A [`VisitedNode`] says where such a node is written and what it belongs to in the lowered tree.

use super::enclosing_declaration::or_file_scope;
use super::*;
use crate::bind::{Decl, Parent, ScopeId};

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
pub(super) enum VisitedKind {
    /// An expression of the lowered tree, without the parentheses around it.
    Expression(ExprId),
    /// A `ParenthesizedExpression` around it: which one, counted from the outermost.
    Parenthesized(ExprId, u32),
    /// The `b` of `a.b`, the `target` of `new.target`, the `meta` of `import.meta`.
    AccessName(ExprId),
    /// The `defer` of `import.defer("m")`.
    ImportDeferName(ExprId),
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
}

impl VisitedKind {
    /// For telling apart where a difference comes from.
    pub(super) fn name(self) -> &'static str {
        match self {
            VisitedKind::Expression(_) => "expression",
            VisitedKind::Parenthesized(..) => "parenthesized",
            VisitedKind::AccessName(_) => "access-name",
            VisitedKind::ImportDeferName(_) => "import-defer-name",
            VisitedKind::BindingName(_) => "variable",
            VisitedKind::BindingPropertyName(_) => "binding-property-name",
            VisitedKind::ThisParameter(_) => "this-parameter",
            VisitedKind::LiteralInMemberName(_)
            | VisitedKind::LiteralInPropertyName(_)
            | VisitedKind::LiteralInBindingPropertyName(_) => "literal-in-computed-name",
            VisitedKind::LiteralType(_) | VisitedKind::LiteralTypeOperand(_) => "literal-type",
            VisitedKind::Directive(_) => "directive",
            VisitedKind::Label(_) => "label",
            VisitedKind::TypeReferenceName(..) => "type-reference-name",
            VisitedKind::HeritageClauseName(..) => "heritage-clause-name",
            VisitedKind::HeritageClausePropertyAccess(..) => "heritage-clause-property-access",
            VisitedKind::ImportTypeQualifierName(..) => "import-type-qualifier-name",
            VisitedKind::ImportEqualsName(..) => "import-equals-name",
        }
    }
}

impl Checker<'_> {
    /// `typeWriterWalker.visitNode` over `forEachASTNode`, in no particular order.
    pub(super) fn visited_nodes(&self, file: FileId) -> Vec<VisitedNode> {
        let hir = self.hir(file);
        let mut visitor = Visitor {
            c: self,
            file,
            hir,
            nodes: Vec::with_capacity(hir.exprs.len() * 2),
        };
        visitor.expressions();
        visitor.names();
        visitor.statements();
        visitor.type_nodes();
        // `forEachASTNode` leaves out what is reparsed from a JSDoc comment, and a comment is no child of a node.
        visitor.nodes.retain(|node| !hir.is_in_jsdoc(node.start));
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
            | VisitedKind::ImportDeferName(e) => self.enclosing_scope_of_expr(file, e),
            VisitedKind::BindingName(pat) => self.enclosing_scope_of_pat(file, pat),
            VisitedKind::LiteralInBindingPropertyName(p) | VisitedKind::BindingPropertyName(p)
                if hir[p].value.is_some() =>
            {
                self.enclosing_scope_of_pat(file, hir[p].value)
            }
            VisitedKind::ThisParameter(f) => self.enclosing_scope_of_declaration(file, Decl::Fn(f)),
            VisitedKind::LiteralInMemberName(m) => self.enclosing_scope_of_member(file, m),
            VisitedKind::LiteralInPropertyName(p) => self.enclosing_scope_of_property(file, p),
            VisitedKind::LiteralType(node)
            | VisitedKind::LiteralTypeOperand(node)
            | VisitedKind::TypeReferenceName(node, _)
            | VisitedKind::HeritageClauseName(node, _)
            | VisitedKind::HeritageClausePropertyAccess(node, _)
            | VisitedKind::ImportTypeQualifierName(node, _) => {
                or_file_scope(bound.type_scope[node.idx()])
            }
            VisitedKind::ImportEqualsName(import, _) => {
                self.enclosing_scope_of_declaration(file, Decl::ImportEquals(import))
            }
            VisitedKind::Label(s) => or_file_scope(bound.stmt_scope[s.idx()]),
            VisitedKind::LiteralInBindingPropertyName(_)
            | VisitedKind::BindingPropertyName(_)
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

    /// `createMissingNode`: an identifier the parser missed at `pos` is a node without text, where the token before it ends. The
    /// harness puts it on the line of the token after it (`SkipTrivia`).
    fn missing_identifier(&mut self, pos: u32, kind: VisitedKind) {
        if self.hir.has_parse_diagnostics {
            let start = self.skip_trivia(self.c.end_of_token_before(self.file, pos));
            let end = start;
            self.nodes.push(VisitedNode { start, end, kind });
        }
    }

    /// Takes the identifiers of the entity name `names`, which is written at `start`.
    fn entity_name(&mut self, start: u32, names: IdList<Atom>, kind: impl Fn(u32) -> VisitedKind) {
        let ranges = self.c.entity_name_ranges(self.file, start, names);
        for (position, (start, end)) in (0..).zip(ranges) {
            self.node(start, end, kind(position));
        }
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
                ExprKind::String(_) if hir.text.get(expr.pos as usize) == Some(&b'#') => {
                    let is_left_of_in = hir
                        .parens
                        .binary_search_by_key(&e.0, |paren| paren.0.0)
                        .is_err()
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
                ExprKind::Dot { name_pos, .. }
                    if hir.text.get(name_pos as usize) != Some(&b'#') =>
                {
                    self.token(name_pos, VisitedKind::AccessName(e));
                }
                ExprKind::ImportMeta | ExprKind::NewTarget => {
                    if let Some(name) = self.meta_property_name(expr.pos) {
                        self.token(name, VisitedKind::AccessName(e));
                    }
                }
                ExprKind::ImportCall(specifier)
                    if hir
                        .deferred_import_calls
                        .iter()
                        .any(|call| call.0 == specifier) =>
                {
                    if let Some(name) = self.meta_property_name(expr.pos) {
                        self.token(name, VisitedKind::ImportDeferName(e));
                    }
                }
                _ => {}
            }
            self.node(
                self.c.start_inside_parentheses(file, e),
                self.c.end_inside_parentheses(file, e),
                VisitedKind::Expression(e),
            );
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
        // `IsInExpressionContext` does not hold right under an `ExportAssignment`. The one statement of a JSON file is an
        // `ExpressionStatement`, which is kept as `export =`.
        not_visited.extend(hir.stmts.iter().filter_map(|stmt| match stmt.kind {
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)
                if e.is_some()
                    && hir.kind != FileKind::Json
                    && hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_err()
                    && is_literal(e) =>
            {
                Some(e)
            }
            _ => None,
        }));
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
            // The empty `{}`
            not_missed.extend(hir.ids(jsx.children).chain(values()));
            // The name of an intrinsic element is an identifier, which the lowered tree keeps as a string.
            not_visited.extend(
                [jsx.tag, jsx.close_tag]
                    .into_iter()
                    .filter(|&tag| tag.is_some() && matches!(hir[tag].kind, ExprKind::String(_))),
            );
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
        let mut is_not_visited = vec![false; hir.exprs.len()];
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

    /// The names in patterns, parameter lists and `import x = a.b`, and the literals in computed names.
    fn names(&mut self) {
        let (hir, file) = (self.hir, self.file);
        for (index, pat) in hir.pats.iter().enumerate() {
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
            self.literal_in_computed_name(prop.key, prop.pos, kind);
            // In `{ a }` the one identifier is the name that is bound. A string or a number is no identifier.
            let is_identifier = hir.text.get(prop.pos as usize).is_some_and(|&first| {
                first.is_ascii_alphabetic() || matches!(first, b'_' | b'$' | b'\\') || first >= 0x80
            });
            if matches!(prop.key, PropKey::Name(_))
                && !prop.is_rest
                && is_identifier
                && prop.value.is_some()
                && hir[prop.value].pos != prop.pos
            {
                self.token(prop.pos, VisitedKind::BindingPropertyName(p));
            }
        }
        for (index, prop) in hir.props.iter().enumerate() {
            let kind = VisitedKind::LiteralInPropertyName(PropId(index as u32));
            self.literal_in_computed_name(prop.key, prop.pos, kind);
        }
        for (index, member) in hir.members.iter().enumerate() {
            let m = MemberId(index as u32);
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
            self.literal_in_computed_name(member.key, start, VisitedKind::LiteralInMemberName(m));
        }
        for index in 0..hir.fns.len() {
            let f = FnId(index as u32);
            if let Some(start) = self.c.start_of_this_parameter(file, f) {
                self.node(start, start + 4, VisitedKind::ThisParameter(f));
            }
        }
        for (index, import) in hir.import_equals.iter().enumerate() {
            let id = ImportEqualsId(index as u32);
            if let ImportEqualsTarget::Entity(entity) = import.target
                && let Some(start) = self.c.start_of_import_equals_reference(file, id)
            {
                self.entity_name(start, entity, |at| VisitedKind::ImportEqualsName(id, at));
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
        let implemented = hir.classes.iter().map(|class| class.implements);
        let extended = hir.interfaces.iter().map(|interface| interface.extends);
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
                // A `QualifiedName` is neither an expression node nor an identifier.
                TypeNodeKind::Ref { name, .. } => {
                    self.entity_name(start, name, |at| VisitedKind::TypeReferenceName(node, at));
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
