//! `reference-tracker.mjs`

use super::get_property_name::{get_property_name, property_name_of_key};
use super::get_string_if_constant::get_string_if_constant;
use crate::ast::{BinOp, Call, Expr, ExprKind, File, Name, Node, StmtKind, TypeKind};
use crate::semantic::{Reference, Symbol};
use crate::span::Span;
use crate::utils::estree_compat::{Target, TargetKind, is_sequence_root};
use smallvec::SmallVec;

/// eslint-utils' `TraceMap`: which uses of an object to report, and the same for its properties.
///
/// `T` is what upstream puts at `[READ]`, `[CALL]` and `[CONSTRUCT]`, and gets back as `info`.
/// Where that is `true`, use `()`.
///
/// It can be a constant:
/// ```ignore
/// // { Object: { assign: { [CALL]: true } }, RegExp: { [CALL]: true, [CONSTRUCT]: true } }
/// const MAP: TraceMap<'static, ()> = TraceMap::new(&[
///     ("Object", TraceMap::new(&[("assign", TraceMap::EMPTY.call(()))])),
///     ("RegExp", TraceMap::EMPTY.call(()).construct(())),
/// ]);
/// ```
/// or be made from options:
/// ```ignore
/// let members: Vec<_> = names.iter().map(|name| (name.as_str(), TraceMap::EMPTY.call(()))).collect();
/// let map = TraceMap::new(&members);
/// ```
#[derive(Copy, Clone, Debug)]
pub struct TraceMap<'m, T> {
    /// `[READ]`
    pub read: Option<T>,
    /// `[CALL]`
    pub call: Option<T>,
    /// `[CONSTRUCT]`
    pub construct: Option<T>,
    /// `[ESM]: true`: the module is an ES module, whose `default` export is not the module itself.
    pub esm: bool,
    /// The properties, by name.
    pub members: &'m [(&'m str, TraceMap<'m, T>)],
}

impl<'m, T: Copy> TraceMap<'m, T> {
    pub const EMPTY: Self = TraceMap::new(&[]);

    pub const fn new(members: &'m [(&'m str, TraceMap<'m, T>)]) -> Self {
        TraceMap {
            read: None,
            call: None,
            construct: None,
            esm: false,
            members,
        }
    }

    /// `[READ]: info`
    pub const fn read(self, info: T) -> Self {
        TraceMap {
            read: Some(info),
            ..self
        }
    }

    /// `[CALL]: info`
    pub const fn call(self, info: T) -> Self {
        TraceMap {
            call: Some(info),
            ..self
        }
    }

    /// `[CONSTRUCT]: info`
    pub const fn construct(self, info: T) -> Self {
        TraceMap {
            construct: Some(info),
            ..self
        }
    }

    /// `[ESM]: true`
    pub const fn esm(self) -> Self {
        TraceMap { esm: true, ..self }
    }

    fn get(&self, name: &[u8]) -> Option<(&'m str, &'m TraceMap<'m, T>)> {
        let (name, map) = self
            .members
            .iter()
            .find(|member| member.0.as_bytes() == name)?;
        Some((*name, map))
    }
}

/// eslint-utils' `READ`, `CALL` and `CONSTRUCT`, as the `type` of a tracked reference.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ReferenceKind {
    Read,
    Call,
    Construct,
}

/// eslint-utils' `TrackedReferences`: one use of something that a [`TraceMap`] asks for.
#[derive(Clone, Debug)]
pub struct TrackedReference<'a, 'm, T> {
    /// - `Call`, `Construct`: the call or the `new` expression.
    /// - `Read`: the identifier or the member access. In a destructuring pattern the `PatProp` or
    ///   the `Prop`. Of a module the `require()` call, the `Stmt` of the import or the export, the
    ///   `ImportSpec` or the `ExportSpec`.
    ///
    /// Where upstream has an identifier that is no node here, it is what the identifier is part of,
    /// and `span` is that of the identifier: the `Stmt` of the import for the
    /// `ImportDefaultSpecifier`, [`Reference::node`] for a name in a type.
    pub node: Node<'a>,
    /// The range of the node that upstream reports.
    pub span: Span,
    /// The names in the trace map that lead here: `["Object", "assign"]`.
    pub path: SmallVec<[&'m str; 4]>,
    pub kind: ReferenceKind,
    pub info: T,
}

impl<'a, T> TrackedReference<'a, '_, T> {
    /// `node`, if it is an expression.
    #[inline]
    pub fn expr(&self) -> Option<Expr<'a>> {
        self.node.as_expr()
    }

    /// The callee and the arguments, if `kind` is `Call` or `Construct`.
    pub fn call(&self) -> Option<Call<'a>> {
        match self.expr()?.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => Some(call),
            _ => None,
        }
    }
}

/// eslint-utils' `ReferenceTrackerOptions["mode"]`: how an `import` of a CommonJS module, one
/// whose trace map has no `[ESM]`, is understood.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Mode {
    /// The module is the `default` export.
    #[default]
    Strict,
    /// Its properties are named exports as well.
    Legacy,
}

/// eslint-utils' `ReferenceTracker`: finds the uses of global variables and of modules, through
/// aliases, destructuring and the global object.
///
/// `new ReferenceTracker(sourceCode.getScope(program))` is `ReferenceTracker::new(file)`.
#[derive(Copy, Clone)]
pub struct ReferenceTracker<'a, 'g> {
    file: &'a File<'a>,
    mode: Mode,
    global_object_names: &'g [&'g str],
}

/// A trace map, or what `import` makes of that of a CommonJS module.
#[derive(Copy, Clone)]
enum View<'m, T> {
    Map(&'m TraceMap<'m, T>),
    /// `{ default: map }`
    Default(&'m TraceMap<'m, T>),
    /// `{ default: map, ...map }`
    DefaultAndMembers(&'m TraceMap<'m, T>),
}

impl<'m, T: Copy> View<'m, T> {
    /// What has the `[READ]`, `[CALL]` and `[CONSTRUCT]`.
    fn own(self) -> Option<&'m TraceMap<'m, T>> {
        match self {
            View::Map(map) | View::DefaultAndMembers(map) => Some(map),
            View::Default(_) => None,
        }
    }

    fn get(self, name: &[u8]) -> Option<(&'m str, View<'m, T>)> {
        let default = |map| (name == b"default").then_some(("default", View::Map(map)));
        let member =
            |map: &'m TraceMap<'m, T>| map.get(name).map(|(name, map)| (name, View::Map(map)));
        match self {
            View::Map(map) => member(map),
            View::Default(map) => default(map),
            View::DefaultAndMembers(map) => member(map).or_else(|| default(map)),
        }
    }
}

/// ESLint's `Variable`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Variable<'a> {
    Symbol(Symbol<'a>),
    /// One that the file does not declare.
    Global(Name<'a>),
}

type Path<'m> = SmallVec<[&'m str; 4]>;

fn with<'m>(path: &Path<'m>, name: &'m str) -> Path<'m> {
    let mut path = path.clone();
    path.push(name);
    path
}

struct Walk<'a, 'm, T> {
    file: &'a File<'a>,
    /// The variables whose references are being followed.
    variables: SmallVec<[Variable<'a>; 4]>,
    found: Vec<TrackedReference<'a, 'm, T>>,
}

impl<'a, 'g> ReferenceTracker<'a, 'g> {
    pub fn new(file: &'a File<'a>) -> Self {
        ReferenceTracker {
            file,
            mode: Mode::Strict,
            global_object_names: &["global", "globalThis", "self", "window"],
        }
    }

    /// The option `mode`.
    pub fn with_mode(self, mode: Mode) -> Self {
        ReferenceTracker { mode, ..self }
    }

    /// The option `globalObjectNames`.
    pub fn with_global_object_names(self, global_object_names: &'g [&'g str]) -> Self {
        ReferenceTracker {
            global_object_names,
            ..self
        }
    }

    fn walk<'m, T: Copy>(&self) -> Walk<'a, 'm, T> {
        Walk {
            file: self.file,
            variables: SmallVec::new(),
            found: Vec::new(),
        }
    }

    /// eslint-utils' `iterateGlobalReferences`: the uses of the global variables that are the
    /// members of `map`, as themselves or as properties of the global object. A variable that the
    /// file declares or assigns to is left out, and so is one that is not configured to exist.
    pub fn iterate_global_references<'m, T: Copy>(
        &self,
        map: &'m TraceMap<'m, T>,
    ) -> Vec<TrackedReference<'a, 'm, T>> {
        let mut walk = self.walk();
        for (name, member) in map.members {
            if let Some(variable) = walk.unmodified_global(name.as_bytes()) {
                walk.variable_references(
                    variable,
                    &SmallVec::from_slice(&[*name]),
                    View::Map(member),
                    true,
                );
            }
        }
        for name in self.global_object_names {
            if let Some(variable) = walk.unmodified_global(name.as_bytes()) {
                walk.variable_references(variable, &SmallVec::new(), View::Map(map), false);
            }
        }
        walk.found
    }

    /// eslint-utils' `iterateCjsReferences`: the uses of the modules that are the members of
    /// `map`, where they are loaded by `require()`.
    pub fn iterate_cjs_references<'m, T: Copy>(
        &self,
        map: &'m TraceMap<'m, T>,
    ) -> Vec<TrackedReference<'a, 'm, T>> {
        const REQUIRE: TraceMap<'static, ()> =
            TraceMap::new(&[("require", TraceMap::EMPTY.call(()))]);
        let mut walk = self.walk();
        for required in self.iterate_global_references(&REQUIRE) {
            let (Some(node), Some(call)) = (required.expr(), required.call()) else {
                continue;
            };
            let Some(key) = call
                .args()
                .first()
                .and_then(|specifier| get_string_if_constant(specifier, None))
            else {
                continue;
            };
            let Some((key, module)) = map.get(&key) else {
                continue;
            };
            let path: Path<'m> = SmallVec::from_slice(&[key]);
            walk.report(node.into(), &path, ReferenceKind::Read, module.read);
            walk.property_references(node, &path, View::Map(module));
        }
        walk.found
    }

    /// eslint-utils' `iterateEsmReferences`: the uses of the modules that are the members of
    /// `map`, where they are loaded by `import` or `export .. from`.
    pub fn iterate_esm_references<'m, T: Copy>(
        &self,
        map: &'m TraceMap<'m, T>,
    ) -> Vec<TrackedReference<'a, 'm, T>> {
        let mut walk = self.walk();
        for statement in self.file.body() {
            let specifier = match statement.kind() {
                StmtKind::Import(import) => Some(import.spec()),
                StmtKind::ExportNamed(export) => export.spec(),
                StmtKind::ExportStar { spec, .. } => spec,
                _ => None,
            };
            let Some((key, module)) = specifier.and_then(|specifier| map.get(specifier.bytes()))
            else {
                continue;
            };
            let path: Path<'m> = SmallVec::from_slice(&[key]);
            walk.report(statement.into(), &path, ReferenceKind::Read, module.read);

            let view = match (module.esm, self.mode) {
                (true, _) => View::Map(module),
                (false, Mode::Legacy) => View::DefaultAndMembers(module),
                (false, Mode::Strict) => View::Default(module),
            };
            let first = walk.found.len();
            match statement.kind() {
                StmtKind::ExportStar { .. } => {
                    for (name, member) in module.members {
                        walk.report(
                            statement.into(),
                            &with(&path, name),
                            ReferenceKind::Read,
                            member.read,
                        );
                    }
                    continue;
                }
                StmtKind::Import(import) => {
                    let scope = self.file.top_level_scope();
                    let variable = |name: Name<'a>| scope.get_name(name).map(Variable::Symbol);
                    if let Some(local) = import.default()
                        && let Some((name, next)) = view.get(b"default")
                    {
                        let path = with(&path, name);
                        walk.report_at(
                            statement.into(),
                            local.span(),
                            &path,
                            next.own().and_then(|map| map.read),
                        );
                        if let Some(variable) = variable(local.name()) {
                            walk.variable_references(variable, &path, next, false);
                        }
                    }
                    if let Some(local) = import.namespace()
                        && let Some(variable) = variable(local.name())
                    {
                        walk.variable_references(variable, &path, view, false);
                    }
                    for named in import.named() {
                        let Some((name, next)) = view.get(named.imported().bytes()) else {
                            continue;
                        };
                        let path = with(&path, name);
                        walk.report(
                            named.into(),
                            &path,
                            ReferenceKind::Read,
                            next.own().and_then(|map| map.read),
                        );
                        if let Some(variable) = variable(named.local().name()) {
                            walk.variable_references(variable, &path, next, false);
                        }
                    }
                }
                StmtKind::ExportNamed(export) => {
                    for item in export.items() {
                        if let Some((name, next)) = view.get(item.local().bytes()) {
                            let read = next.own().and_then(|map| map.read);
                            walk.report(item.into(), &with(&path, name), ReferenceKind::Read, read);
                        }
                    }
                }
                _ => {}
            }
            if !module.esm {
                // The `default` that stands for the module itself is not part of the path.
                let mut at = 0;
                walk.found.retain_mut(|found| {
                    at += 1;
                    if at <= first {
                        return true;
                    }
                    if found.path.get(1) == Some(&"default") {
                        found.path.remove(1);
                    }
                    found.path.len() >= 2 || found.kind != ReferenceKind::Read
                });
            }
        }
        walk.found
    }

    /// eslint-utils' `iteratePropertyReferences`: the uses of the value of `expr` that `map` asks
    /// for.
    pub fn iterate_property_references<'m, T: Copy>(
        &self,
        expr: Expr<'a>,
        map: &'m TraceMap<'m, T>,
    ) -> Vec<TrackedReference<'a, 'm, T>> {
        let mut walk = self.walk();
        walk.property_references(expr, &SmallVec::new(), View::Map(map));
        walk.found
    }
}

/// Upstream's `isPassThrough`: the parent, if it has the value of `e`, as `a || e` and `c ? a : e`
/// have.
fn pass_through_parent(e: Expr<'_>) -> Option<Expr<'_>> {
    let parent = e.parent().as_expr()?;
    let passes = match parent.kind() {
        ExprKind::Cond { yes, no, .. } => yes == e || no == e,
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            ..
        } => true,
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => right == e && is_sequence_root(parent),
        ExprKind::As { .. }
        | ExprKind::AsConst(_)
        | ExprKind::Satisfies { .. }
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. } => true,
        _ => false,
    };
    passes.then_some(parent)
}

/// Whether `member`, a `Dot` or an `Index`, is a `MemberExpression` of ESTree: not the
/// `JSXMemberExpression` of `<a.b />`, nor the `TSQualifiedName` of `typeof a.b` in a type.
fn is_member_expression(member: Expr<'_>) -> bool {
    let mut whole = member;
    loop {
        match whole.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { .. } => whole = parent,
                ExprKind::Jsx(jsx) => {
                    return jsx.tag() != Some(whole) && jsx.close_tag() != Some(whole);
                }
                _ => return true,
            },
            Node::Type(ty) => return !matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return true,
        }
    }
}

impl<'a, 'm, T: Copy> Walk<'a, 'm, T> {
    fn report_at(&mut self, node: Node<'a>, span: Span, path: &Path<'m>, read: Option<T>) {
        if let Some(info) = read {
            self.found.push(TrackedReference {
                node,
                span,
                path: path.clone(),
                kind: ReferenceKind::Read,
                info,
            });
        }
    }

    /// Reports `node`, if the trace map has an `info` for this kind of use.
    fn report(&mut self, node: Node<'a>, path: &Path<'m>, kind: ReferenceKind, info: Option<T>) {
        if let Some(info) = info {
            self.found.push(TrackedReference {
                node,
                span: node.span(),
                path: path.clone(),
                kind,
                info,
            });
        }
    }

    /// The global variable `name`, unless upstream's `isModifiedGlobal` holds. `None` as well if
    /// nothing refers to it.
    fn unmodified_global(&self, name: &[u8]) -> Option<Variable<'a>> {
        let mut references = self.file.unresolved_references_to(name);
        let first = references.next()?;
        let is_modified = first.is_write() || references.any(Reference::is_write);
        (!is_modified && self.file.global(name).is_some()).then(|| Variable::Global(first.name()))
    }

    /// Upstream's `_iterateVariableReferences`.
    fn variable_references(
        &mut self,
        variable: Variable<'a>,
        path: &Path<'m>,
        map: View<'m, T>,
        should_report: bool,
    ) {
        if self.variables.contains(&variable) {
            return;
        }
        self.variables.push(variable);
        let references: Vec<Reference<'a>> = match variable {
            Variable::Symbol(symbol) => symbol.references().collect(),
            Variable::Global(name) => self.file.unresolved_references_to(name.bytes()).collect(),
        };
        for reference in references
            .into_iter()
            .filter(|reference| reference.is_read())
        {
            if should_report {
                self.report_at(
                    reference.node(),
                    reference.span(),
                    path,
                    map.own().and_then(|map| map.read),
                );
            }
            if let Some(identifier) = reference.expr() {
                self.property_references(identifier, path, map);
            }
        }
        self.variables.pop();
    }

    /// Upstream's `_iteratePropertyReferences`.
    fn property_references(&mut self, root: Expr<'a>, path: &Path<'m>, map: View<'m, T>) {
        let mut node = root;
        while let Some(parent) = pass_through_parent(node) {
            node = parent;
        }
        match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                    if obj == node && is_member_expression(parent) =>
                {
                    let Some((name, next)) =
                        get_property_name(parent, None).and_then(|key| map.get(&key))
                    else {
                        return;
                    };
                    let path = with(path, name);
                    self.report(
                        parent.into(),
                        &path,
                        ReferenceKind::Read,
                        next.own().and_then(|map| map.read),
                    );
                    self.property_references(parent, &path, next);
                }
                ExprKind::Call(call) if call.callee() == node => {
                    self.report(
                        parent.into(),
                        path,
                        ReferenceKind::Call,
                        map.own().and_then(|map| map.call),
                    );
                }
                ExprKind::New(call) if call.callee() == node => {
                    self.report(
                        parent.into(),
                        path,
                        ReferenceKind::Construct,
                        map.own().and_then(|map| map.construct),
                    );
                }
                // Also the default value in a destructuring assignment, after which nothing follows.
                ExprKind::Assign { target, value, .. } if value == node => {
                    self.lhs_references(Target::Expr(target), path, map);
                    self.property_references(parent, path, map);
                }
                _ => {}
            },
            Node::VarDecl(declaration) => {
                self.lhs_references(Target::Pat(declaration.pat()), path, map)
            }
            Node::Param(param) if param.default() == Some(node) => {
                self.lhs_references(Target::Pat(param.pat()), path, map)
            }
            Node::PatProp(prop) if prop.default() == Some(node) => {
                self.lhs_references(Target::Pat(prop.value()), path, map)
            }
            Node::PatElem(element) => {
                if let Some(pat) = element.pat() {
                    self.lhs_references(Target::Pat(pat), path, map);
                }
            }
            _ => {}
        }
    }

    /// Upstream's `_iterateLhsReferences`.
    fn lhs_references(&mut self, pattern: Target<'a>, path: &Path<'m>, map: View<'m, T>) {
        match pattern.kind() {
            TargetKind::Ident(name) => {
                let symbol = match pattern {
                    Target::Pat(pat) => pat.symbol(),
                    Target::Expr(e) => e.symbol(),
                };
                let variable = match symbol {
                    Some(symbol) => Variable::Symbol(symbol),
                    None if self.file.global(name.bytes()).is_some() => Variable::Global(name),
                    None => return,
                };
                self.variable_references(variable, path, map, false);
            }
            TargetKind::Object => {
                for property in pattern.elements() {
                    let Some((name, next)) = (property.key)
                        .and_then(|key| property_name_of_key(key, None))
                        .and_then(|key| map.get(&key))
                    else {
                        continue;
                    };
                    let path = with(path, name);
                    self.report(
                        property.node,
                        &path,
                        ReferenceKind::Read,
                        next.own().and_then(|map| map.read),
                    );
                    if let Some(target) = property.target {
                        self.lhs_references(target, &path, next);
                    }
                }
            }
            TargetKind::Array | TargetKind::Other(_) => {}
        }
    }
}
