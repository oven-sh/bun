//! The types of values that have names: variables, parameters, functions, classes, imports; and what functions return.

use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeKind, UNREACHABLE};

#[derive(Copy, Clone, Debug)]
pub struct IterationTypes {
    pub yielded: TypeId,
    pub returned: TypeId,
    pub next: TypeId,
}

/// `IterationTypes`: what is yielded, what is returned in the end, what `next` is to be sent. Any of them may be missing. All
/// missing: there is nothing to go through.
#[derive(Copy, Clone, Default)]
pub(super) struct Iter3 {
    pub y: Option<TypeId>,
    pub r: Option<TypeId>,
    pub n: Option<TypeId>,
}

impl Iter3 {
    pub fn has_types(&self) -> bool {
        self.y.is_some() || self.r.is_some() || self.n.is_some()
    }

    fn all(ty: TypeId) -> Iter3 {
        Iter3 {
            y: Some(ty),
            r: Some(ty),
            n: Some(ty),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum IteratorMethod {
    Next,
    Return,
    Throw,
}

impl<'p> Checker<'p> {
    /// What `sym` is where a value is expected.
    pub fn type_of_symbol(&mut self, sym: Sym) -> TypeId {
        if let Some(known) = self.p.symbol_types.get(&sym) {
            return known;
        }
        if !self.enter(Query::Symbol(sym)) {
            return if self.came_full_circle {
                TypeId::ANY
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.type_of_symbol_uncached(sym);
        let ty = self.force(ty);
        let holds = self.leave();
        if self.left_a_circle {
            self.p.circular_symbols.insert(sym, ());
            return self.p.symbol_types.insert(sym, TypeId::ANY);
        }
        if holds {
            self.p.symbol_types.insert(sym, ty);
        }
        ty
    }

    fn type_of_symbol_uncached(&mut self, sym: Sym) -> TypeId {
        let mut flags = self.files().flags(sym);
        // `mergeSymbol` keeps a declaration from another file out of the symbol when the flags conflict. `Files::merge_symbols`
        // merges it anyway, so drop the value kinds that lost the name.
        let value_kinds = SymFlags::VARIABLE
            | SymFlags::CLASS
            | SymFlags::FUNCTION
            | SymFlags::ENUM
            | SymFlags::VALUE_MODULE;
        if flags.contains(SymFlags::MERGED)
            && flags.intersection(value_kinds).bits().count_ones() > 1
        {
            flags = flags.difference(value_kinds.difference(self.flags_that_have_the_name(sym)));
        }
        // `getTypeOfSymbol`: what a name stands for is asked last, so what it is declared as where it stands goes first.
        if flags.contains(SymFlags::ALIAS) && !flags.intersects(SymFlags::VALUE) {
            return self.type_of_alias(sym);
        }
        // `getTypeOfVariableOrParameterOrPropertyWorker`: `exports` is what the module is to those who require it, `module` has it.
        if flags.contains(SymFlags::MODULE_EXPORTS) {
            let module = self.files().file_symbol(sym.file);
            let value = self.files().module_value(module);
            let exports = self.type_of_symbol(value);
            if self.files().symbol(sym).name == known::exports {
                return exports;
            }
            let prop = Prop {
                name: known::exports,
                flags: PropFlags::empty(),
                source: PropSource::Type(exports),
                mapper: MapperId::IDENTITY,
            };
            return self.synth(Shape {
                props: vec![prop],
                ..Shape::default()
            });
        }
        if flags.intersects(SymFlags::VARIABLE) {
            for (file, decl) in self.files().decls(sym) {
                if let Decl::Var(pat) | Decl::Param(pat) = decl {
                    return self.type_of_pat(file, pat);
                }
            }
        }
        if let Some(ty) = self.type_of_assignment_declarations(sym) {
            return ty;
        }
        if flags.contains(SymFlags::CLASS) {
            return self.type_of_class_value(sym);
        }
        if flags.contains(SymFlags::FUNCTION) {
            let mut mapper = MapperId::IDENTITY;
            for (file, decl) in self.files().decls(sym) {
                if let Decl::Fn(f) = decl {
                    let scope = self.bound(file).fns[f.idx()].scope;
                    let parent = self.bound(file).scopes[scope.idx()].parent;
                    mapper = self.identity_mapper(file, parent);
                    break;
                }
            }
            return self.intern(TypeData::Anon {
                origin: Origin::Function(sym),
                mapper,
            });
        }
        if flags.contains(SymFlags::ENUM) {
            return self.intern(TypeData::Anon {
                origin: Origin::EnumObject(sym),
                mapper: MapperId::IDENTITY,
            });
        }
        if flags.contains(SymFlags::ENUM_MEMBER) {
            let ty = self.enum_member_type(sym);
            return self.fresh(ty);
        }
        if flags.contains(SymFlags::VALUE_MODULE) {
            // `isShorthandAmbientModuleSymbol`: of `declare module "m";` nothing is known.
            if self
                .files()
                .decls(sym)
                .iter()
                .any(|&(f, d)| matches!(d, Decl::Module(id) if !self.hir(f)[id].has_body))
            {
                return TypeId::ANY;
            }
            return self.intern(TypeData::Anon {
                origin: Origin::Module(sym),
                mapper: MapperId::IDENTITY,
            });
        }
        if flags.contains(SymFlags::EXPORT_VALUE) {
            for (file, decl) in self.files().decls(sym) {
                if let Decl::ExportExpr(stmt) = decl
                    && let StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) =
                        self.hir(file)[stmt].kind
                {
                    // A literal stays the literal it is, but for what a JSON file holds (`getTypeOfVariableOrParameterOrPropertyWorker`).
                    let ty = self.type_of_expr(file, e);
                    return if self.hir(file).kind == FileKind::Json {
                        self.widened(ty)
                    } else {
                        self.widened_for_declaration(ty)
                    };
                }
            }
        }
        if !flags.intersects(SymFlags::VALUE) {
            // `declareClassMember`: a static member shares one symbol with the export of the same name from a namespace merged
            // with the class.
            if let Some(class) = self.files().static_member_of_same_name(sym) {
                let statics = self.type_of_class_value(class);
                let name = self.files().symbol(sym).name;
                return self.type_of_property(statics, name).unwrap_or(TypeId::ANY);
            }
            // A symbol that is not a value has the error type.
            return TypeId::ANY;
        }
        TypeId::UNRESOLVED
    }

    /// `getWidenedTypeForAssignmentDeclaration` for a CommonJS export declared by assignments.
    fn type_of_assignment_declarations(&mut self, sym: Sym) -> Option<TypeId> {
        let ty = self.widened_assigned_type(sym)?;
        Some(if self.is_all_nullable(ty) {
            TypeId::ANY
        } else {
            ty
        })
    }

    /// Whether `getWidenedTypeForAssignmentDeclaration` reports an implicit `any` for the CommonJS export `sym`: every assigned
    /// type is `null` or `undefined`.
    pub(super) fn assignment_declarations_are_nullable(&mut self, sym: Sym) -> bool {
        self.widened_assigned_type(sym)
            .is_some_and(|ty| self.is_all_nullable(ty))
    }

    /// `filterType(ty, flags &^ TypeFlagsNullable != 0) == neverType`, which also holds for `never`.
    fn is_all_nullable(&self, ty: TypeId) -> bool {
        self.parts(ty)
            .iter()
            .all(|m| m.is_undefined() || m.is_null())
    }

    /// `getWidenedTypeForAssignmentDeclaration` up to its all-nullable check: the widened union of the types assigned to the
    /// CommonJS export `sym`. `None` if no assignment declares `sym`.
    fn widened_assigned_type(&mut self, sym: Sym) -> Option<TypeId> {
        let decls = self.files().decls(sym);
        let mut types: Vec<TypeId> = Vec::new();
        let mut any = false;
        for (index, &(file, decl)) in decls.iter().enumerate() {
            let (Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment)) = decl else {
                continue;
            };
            any = true;
            // `getAssignmentDeclarationInitializerType`: `Object.defineProperty(exports, "a", descriptor)` declares what the descriptor says.
            if matches!(self.hir(file)[assignment].kind, ExprKind::Call(_)) {
                let name = self.files().symbol(sym).name;
                let ty = self.widened_type_of_assignments(file, name, &[assignment]);
                if !types.contains(&ty) {
                    types.push(ty);
                }
                continue;
            }
            // `GetRightMostAssignedExpression` also steps through compound assignments.
            let mut value = assignment;
            while let ExprKind::Assign { value: next, .. } = self.hir(file)[value].kind {
                value = next;
            }
            let ty = self.type_of_expr(file, value);
            let ty = self.regular(ty);
            let ty = if self.is_empty_array_literal_type(file, value, ty) {
                self.array_of(TypeId::ANY)
            } else {
                ty
            };
            // `exports.a = exports.b = void 0` first, as compilers write it, says nothing.
            if matches!(decl, Decl::ExportsProperty(_))
                && index == 0
                && decls.len() > 1
                && ty.is_undefined()
            {
                continue;
            }
            if !types.contains(&ty) {
                types.push(ty);
            }
        }
        if !any {
            return None;
        }
        let ty = if types.is_empty() {
            TypeId::ANY
        } else {
            self.union(&types)
        };
        Some(self.regular_object(ty))
    }

    /// `getTypeOfAlias`, a step at a time: `resolveAlias` stops at the first symbol that is more than an alias, and `getTypeOfSymbol`
    /// goes on from there.
    pub(super) fn type_of_alias(&mut self, sym: Sym) -> TypeId {
        if let Some(ty) = self.type_of_namespace_import(sym) {
            return ty;
        }
        match self.files().alias_target(sym) {
            Some(next) if next != sym => {
                if self.is_kept_next_to_an_exported_value(sym, next) {
                    return TypeId::ANY;
                }
                // `combineValueAndTypeSymbols`: when the export has no value flag of its own, the property of the `export =` value
                // with the same name is the value side.
                if !self.files().flags(next).intersects(SymFlags::VALUE)
                    && let Some(property) = self.imported_property_of_export_equals(sym)
                {
                    return property;
                }
                self.type_of_symbol(next)
            }
            // tsgo keeps `globalThisSymbol` in the globals. It has no `Sym` here.
            None if self.is_import_equals_of_global_this(sym) => self.intern(TypeData::Anon {
                origin: Origin::GlobalThis,
                mapper: MapperId::IDENTITY,
            }),
            _ => match self.type_of_alias_like_expression(sym) {
                Some(ty) => ty,
                None => self.type_of_unresolved_import(sym),
            },
        }
    }

    /// Whether `sym` is declared by `import a = globalThis`.
    fn is_import_equals_of_global_this(&self, sym: Sym) -> bool {
        let hir = self.hir(sym.file);
        self.files().symbol(sym).decls.iter().any(|&decl| {
            matches!(decl, Decl::ImportEquals(import)
                if matches!(hir[import].target, ImportEqualsTarget::Entity(names) if names.len() == 1 && hir.id_at(names, 0) == known::globalThis))
        })
    }

    /// The fallback of `getTargetOfAliasLikeExpression`, followed by `getTypeOfAlias`. In `export = e`, `export default e`,
    /// `module.exports = e` and `exports.x = e`, an entity name `e` that `resolveEntityName` cannot resolve aliases the symbol that
    /// checking `e` records as its `resolvedSymbol`. Returns the declared type of that symbol, or `None` if `sym` has no such
    /// declaration.
    fn type_of_alias_like_expression(&mut self, sym: Sym) -> Option<TypeId> {
        // `getDeclarationOfAliasSymbol` takes the last declaration.
        let (file, decl) = self.files().decls(sym).into_iter().rev().find(|(_, d)| {
            matches!(
                d,
                Decl::ExportExpr(_) | Decl::ModuleExports(_) | Decl::ExportsProperty(_)
            )
        })?;
        let hir = self.hir(file);
        let e = match decl {
            Decl::ExportExpr(stmt) => match hir[stmt].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => e,
                _ => return None,
            },
            Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
                match hir[assignment].kind {
                    ExprKind::Assign { value, .. } => value,
                    _ => return None,
                }
            }
            _ => return None,
        };
        match hir[e].kind {
            // `undefinedSymbol`, `globalThisSymbol` and `argumentsSymbol` have no `Sym`. Any other undeclared name is `unknownSymbol`.
            ExprKind::Ident(name) if self.symbol_of_identifier(file, e, name).is_none() => {
                Some(self.type_of_expr(file, e))
            }
            // `checkPropertyAccessExpressionOrQualifiedName` records a property as `resolvedSymbol`, never an index signature.
            ExprKind::Dot { obj, name, .. } => {
                let object = self.type_of_expr(file, obj);
                // `checkNonNullExpression`
                let object = self.non_null_type(object);
                if self.is_any(object) {
                    return Some(object);
                }
                if let Some((property, _)) = self.declared_property(object, name) {
                    return Some(property);
                }
                // `getPropertyOfTypeEx` also finds the members of `Object` and `Function`, except on a `const enum` object.
                let apparent = self.apparent_type(object);
                let apparent = self.reduced(apparent);
                if !self.is_union(apparent)
                    && !self.is_const_enum_object(apparent)
                    && let Some(members) = self.members(apparent)
                    && members.resolved.prop(name).is_none()
                    && let Some((prop, mapper)) = self.property_of_type(&members, name)
                {
                    return Some(self.type_of_prop(&prop, mapper));
                }
                // `unknownSymbol`
                Some(if self.is_known(object) {
                    TypeId::ANY
                } else {
                    TypeId::UNRESOLVED
                })
            }
            _ => None,
        }
    }

    /// `resolveESModuleSymbol`: what `import * as ns` names has no signatures, and a `default` where one is made up.
    /// `None`: the module, or what it `export =`s, as it stands.
    fn type_of_namespace_import(&mut self, sym: Sym) -> Option<TypeId> {
        let import = self
            .files()
            .symbol(sym)
            .decls
            .iter()
            .find_map(|d| match *d {
                Decl::ImportNamespace(i) => Some(i),
                _ => None,
            })?;
        let file = sym.file;
        let import = &self.hir(file)[import];
        let mode = self.files().mode_of_import(file, import.mode);
        let module = self
            .files()
            .module_of_specifier_as(file, import.spec, mode)?;
        let value = self.files().module_value(module);
        let ty = self.type_of_symbol(value);
        if !self.is_known(ty) || self.is_any(ty) {
            return None;
        }
        let files = self.files();
        // To Node, what an ECMAScript module imports from a file.
        let is_file_to_node = files
            .symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && files.options.module.is_node()
            && files.module(file).is_esm;
        // `getTypeWithSyntheticDefaultOnly`, `isOnlyImportableAsDefault`: a JSON file has a default and nothing else then.
        if is_file_to_node
            && (files.hir(module.file).kind == FileKind::Json
                || files.module(module.file).path.ends_with(".d.json.ts"))
        {
            let default = Prop {
                name: known::default,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            };
            return Some(self.synth(Shape {
                props: vec![default],
                ..Shape::default()
            }));
        }
        // `canHaveSyntheticDefault`
        let with_default = files.synthetic_default(file, module).is_some();
        // With no signatures to drop and no default to make up, the clone has what the module has.
        if self.signatures(ty, false).is_empty() && self.signatures(ty, true).is_empty() {
            if !with_default {
                return None;
            }
            // `isESMFormatImportImportingCommonjsFormatFile`
            let is_commonjs_to_node = is_file_to_node && !files.module(module.file).is_esm;
            if !is_commonjs_to_node && self.prop_of(ty, known::default).is_none() {
                return None;
            }
        }
        Some(self.intern(TypeData::Anon {
            origin: Origin::Namespace {
                module: value,
                with_default,
            },
            mapper: MapperId::IDENTITY,
        }))
    }

    /// `declareModuleMember`: under one name, what a module exports and what it keeps to itself are two symbols, and
    /// `export default F`, `export = F`, `export { F as G }` find the one it keeps. With no value among what is kept that is no
    /// value (`getTypeOfAlias`). `target` is what the alias `alias` is declared to stand for.
    fn is_kept_next_to_an_exported_value(&self, alias: Sym, target: Sym) -> bool {
        let files = self.files();
        if target.file != alias.file || files.flags(target).contains(SymFlags::ALIAS) {
            return false;
        }
        let hir = files.hir(alias.file);
        // A name on its own is looked for where it is written. What follows a dot, or comes from a module, is looked for among exports.
        let looks_the_name_up = files.symbol(alias).decls.iter().any(|d| match *d {
            Decl::ExportExpr(stmt) => {
                matches!(hir[stmt].kind, StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) if matches!(hir[e].kind, ExprKind::Ident(_)))
            }
            // Under its own name it joins what is exported already, which is the value.
            Decl::ExportSpec(spec) => {
                files.symbol(alias).name != files.symbol(target).name
                    && hir.exports.iter().any(|x| x.spec.is_none() && x.items.range().contains(&spec.idx()))
            }
            _ => false,
        });
        if !looks_the_name_up {
            return false;
        }
        let (mut kept, mut kept_value, mut exported_value) = (false, false, false);
        for (f, d) in files.decls(target) {
            let (hir, bound) = (files.hir(f), files.bound(f));
            let (is_value, flags) = match d {
                Decl::Var(mut p) => loop {
                    match bound.pat_parent[p.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => p = outer,
                        PatParent::Var(v) => break (true, hir[v].flags),
                        _ => return false,
                    }
                },
                Decl::Fn(x) => (true, hir[x].flags),
                Decl::Class(x) => (true, hir[x].flags),
                Decl::Enum(x) => (true, hir[x].flags),
                Decl::Interface(x) => (false, hir[x].flags),
                Decl::Alias(x) => (false, hir[x].flags),
                Decl::Module(x) => (bound.module_instantiated[x.idx()], hir[x].flags),
                _ => return false,
            };
            // In something ambient everything may be exported without saying so.
            if flags.contains(Flags::AMBIENT) {
                return false;
            }
            if flags.contains(Flags::EXPORT) {
                exported_value |= is_value;
            } else {
                kept = true;
                kept_value |= is_value;
            }
        }
        kept && !kept_value && exported_value
    }

    /// `getTypeOfFuncClassEnumModuleWorker`, of a class: its static side, in terms of the type parameters around the class
    /// (`getObjectTypeInstantiation`). The constructor of a class that extends a value whose type is a type variable is one of
    /// those as well.
    pub(super) fn type_of_class_value(&mut self, sym: Sym) -> TypeId {
        let class = self
            .files()
            .decls(sym)
            .into_iter()
            .find_map(|(file, decl)| match decl {
                Decl::Class(c) => Some((file, c)),
                _ => None,
            });
        let mut mapper = MapperId::IDENTITY;
        if let Some((file, c)) = class {
            let scope = self.bound(file).class_scope[c.idx()];
            if scope.is_some() {
                let around = self.bound(file).scopes[scope.idx()].parent;
                mapper = self.identity_mapper(file, around);
            }
        }
        let statics = self.intern(TypeData::Anon {
            origin: Origin::ClassStatic(sym),
            mapper,
        });
        // `getBaseTypeVariableOfClass`. Where no type parameter is in scope nothing is of such a type, and the expression is left alone.
        let Some((file, c)) = class else {
            return statics;
        };
        let extends = self.hir(file)[c].extends;
        if mapper == MapperId::IDENTITY || extends.is_none() {
            return statics;
        }
        let base = self.type_of_expr(file, extends);
        let base = self.force(base);
        let variable = match self.data(base) {
            TypeData::Intersection(parts) => {
                parts.iter().copied().find(|&p| self.is_type_variable(p))
            }
            _ if self.is_type_variable(base) => Some(base),
            _ => None,
        };
        match variable {
            // `getBaseConstructorTypeOfClass`, `isConstructorType`: what cannot be constructed is an error, and no base at all.
            Some(variable) if !self.signatures(base, true).is_empty() => {
                self.intersection(&[statics, variable])
            }
            _ => statics,
        }
    }

    /// `symbolFromVariable` of `getExternalModuleMember`: `import { a } from "m"`, `export { a } from "m"` and
    /// `const { a } = require("m")` name a property of the value when `m` has `export = value`. Returns the type of the value and
    /// the type of its property `a`, if it has one. `None` if `sym` is not such an import or export.
    fn property_of_export_equals(&mut self, sym: Sym) -> Option<(TypeId, Option<TypeId>)> {
        let file = sym.file;
        let hir = self.hir(file);
        let files = self.files();
        for decl in &files.symbol(sym).decls {
            let (module, name) = match *decl {
                Decl::ImportSpec(s) => match hir
                    .imports
                    .iter()
                    .find(|i| i.named.range().contains(&s.idx()))
                {
                    Some(import) => (
                        files.module_of_specifier_as(
                            file,
                            import.spec,
                            files.mode_of_import(file, import.mode),
                        ),
                        hir[s].imported,
                    ),
                    None => continue,
                },
                Decl::ExportSpec(s) => match hir
                    .exports
                    .iter()
                    .find(|x| x.items.range().contains(&s.idx()))
                {
                    Some(export) if export.spec.is_some() => (
                        files.module_of_specifier_as(
                            file,
                            export.spec,
                            files.mode_of_import(file, export.mode),
                        ),
                        hir[s].local,
                    ),
                    _ => continue,
                },
                Decl::Require(pat) => match self.bound(file).required_by(hir, pat) {
                    Some((spec, Some(name))) => (files.module_of_specifier(file, spec), name),
                    _ => continue,
                },
                _ => continue,
            };
            let Some(module) = module else { continue };
            let value = files.module_value(module);
            if value == module {
                continue;
            }
            let ty = self.type_of_symbol(value);
            if self.is_any(ty) {
                return Some((ty, None));
            }
            // `skipObjectFunctionPropertyAugment`: what every object and every function has does not count, nor does an index signature.
            let apparent = self.apparent_type(ty);
            let apparent = self.reduced(apparent);
            let found = if self.is_union(apparent) {
                self.type_of_property(apparent, name)
            } else {
                self.prop_of(apparent, name)
                    .map(|(prop, mapper)| self.type_of_prop(&prop, mapper))
            };
            return Some((ty, found));
        }
        None
    }

    /// The type of the property of a module's `export =` value that the import or export specifier `sym` names, if there is one.
    pub(super) fn imported_property_of_export_equals(&mut self, sym: Sym) -> Option<TypeId> {
        self.property_of_export_equals(sym)?.1
    }

    /// `getExternalModuleMember` for an import that resolves to no symbol.
    fn type_of_unresolved_import(&mut self, sym: Sym) -> TypeId {
        match self.property_of_export_equals(sym) {
            Some((_, Some(property))) => property,
            Some((value, None)) if self.is_any(value) => value,
            // `errorNoModuleMemberSymbol` reports the missing member, and the import has the error type.
            Some((value, None)) if self.is_known(value) => TypeId::ANY,
            Some(_) => TypeId::UNRESOLVED,
            None if self.is_alias_in_error(sym) => TypeId::ANY,
            None => TypeId::UNRESOLVED,
        }
    }

    /// Whether the alias `sym` stands for nothing, and that is an error in the program: it is from a module that cannot be
    /// found, or that does not have it. What is in error can be anything.
    pub(super) fn is_alias_in_error(&self, mut sym: Sym) -> bool {
        let files = self.files();
        for _ in 0..32 {
            if !files.flags(sym).contains(SymFlags::ALIAS) {
                return false;
            }
            match files.alias_target(sym) {
                Some(next) if next != sym => sym = next,
                _ => break,
            }
        }
        let file = sym.file;
        let hir = self.hir(file);
        files.symbol(sym).decls.iter().any(|&decl| {
            // `getModeForUsageLocation`: a module is looked for the way the declaration that names it asks for it.
            let (spec, name, mode) = match decl {
                Decl::ImportDefault(i) => (
                    hir[i].spec,
                    known::default,
                    files.mode_of_import(file, hir[i].mode),
                ),
                Decl::ImportNamespace(i) => (
                    hir[i].spec,
                    Atom::NONE,
                    files.mode_of_import(file, hir[i].mode),
                ),
                Decl::ImportSpec(s) => match hir
                    .imports
                    .iter()
                    .find(|i| i.named.range().contains(&s.idx()))
                {
                    Some(import) => (
                        import.spec,
                        hir[s].imported,
                        files.mode_of_import(file, import.mode),
                    ),
                    None => return false,
                },
                Decl::ExportSpec(s) => match hir
                    .exports
                    .iter()
                    .find(|x| x.items.range().contains(&s.idx()))
                {
                    Some(export) if export.spec.is_some() => (
                        export.spec,
                        hir[s].local,
                        files.mode_of_import(file, export.mode),
                    ),
                    _ => return false,
                },
                Decl::ImportEquals(i) => match hir[i].target {
                    ImportEqualsTarget::Require(spec) => {
                        (spec, Atom::NONE, ResolutionMode::Require)
                    }
                    _ => return false,
                },
                _ => return false,
            };
            if files.module_of_specifier_as(file, spec, mode).is_none() {
                return true;
            }
            name.is_some()
                && name != known::default
                && self
                    .module_with_known_exports(file, spec, mode)
                    .is_some_and(|m| files.module_export(m, name).is_none())
        })
    }

    /// What a mutable location initialized with a value of type `ty` is declared as.
    pub fn widened(&mut self, ty: TypeId) -> TypeId {
        let ty = self.widen_literal(ty);
        self.regular_object(ty)
    }

    /// `widenTypeForVariableLikeDeclaration`: what something that has a name is, given what it gets its type from. A `unique symbol`
    /// belongs to the declaration it was made for, which does not come here: to any other it is a `symbol`.
    fn widened_for_declaration(&mut self, ty: TypeId) -> TypeId {
        let ty = if matches!(self.data(ty), TypeData::UniqueSymbol { .. }) {
            TypeId::SYMBOL
        } else {
            ty
        };
        self.regular_object(ty)
    }

    /// Whether `ty` is the type of an object literal expression, as opposed to that of something initialized with one. What a
    /// binding pattern implies is marked too, but no expression has that type: it is never fresh (`getTypeFromObjectBindingPattern`).
    pub fn is_object_literal_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                ..
            } => true,
            TypeData::Synth(shape) => shape.literal.is_of_expression(),
            _ => false,
        }
    }

    /// An object literal without spreads: it has what is written, and that is all.
    pub fn is_closed_object_literal_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                ..
            } => true,
            TypeData::Synth(shape) => matches!(
                shape.literal,
                Literalness::Literal | Literalness::JsxAttributes
            ),
            _ => false,
        }
    }

    fn contains_object_literal(&self, ty: TypeId, depth: u32) -> bool {
        if depth > 6 {
            return false;
        }
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts
                .iter()
                .any(|&p| self.contains_object_literal(p, depth + 1)),
            TypeData::Tuple { elems, .. } => elems
                .iter()
                .any(|&e| self.contains_object_literal(e, depth + 1)),
            TypeData::Ref { args, .. } if self.is_array(ty) => args
                .iter()
                .any(|&a| self.contains_object_literal(a, depth + 1)),
            // What a pattern implies is widened like a literal, into a type that `patternForType` does not know.
            TypeData::Synth(shape)
                if matches!(
                    shape.literal,
                    Literalness::Pattern | Literalness::PatternWithComputedNames
                ) =>
            {
                true
            }
            _ => self.is_object_literal_type(ty),
        }
    }

    /// The type a variable, a result or a type argument gets from an expression of type `ty`: object literals in it become
    /// ordinary object types, and those that are alternatives to one another get each other's properties as `p?: undefined`.
    pub fn regular_object(&mut self, ty: TypeId) -> TypeId {
        let ty = self.widen_objects(ty, None);
        if self.p.files.options.strict_null_checks {
            ty
        } else {
            self.widen_nullish(ty, 0)
        }
    }

    /// Without strictNullChecks, `null` and `undefined` say nothing about what a location is for: it can hold anything. That is for
    /// those that expressions give (`undefinedWideningType`, `nullWideningType`). The ones that are declared stay.
    /// `getWidenedType`, less the object literals.
    fn widen_nullish(&mut self, ty: TypeId, depth: u32) -> TypeId {
        if ty == TypeId::NULL || ty == TypeId::UNDEFINED {
            return TypeId::ANY;
        }
        if depth > 6 {
            return ty;
        }
        match self.data(ty) {
            // No union has `null` or `undefined` in it here.
            TypeData::Union(parts) => match self.widen_nullish_each(parts, depth) {
                Some(widened) => self.union(&widened),
                None => ty,
            },
            TypeData::Intersection(parts) => match self.widen_nullish_each(parts, depth) {
                Some(widened) => self.intersection(&widened),
                None => ty,
            },
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => match self.widen_nullish_each(elems, depth) {
                Some(widened) => self.tuple(&widened, flags, *readonly),
                None => ty,
            },
            TypeData::Ref { target, args } if self.is_array(ty) => {
                match self.widen_nullish_each(args, depth) {
                    Some(widened) => self.intern(TypeData::Ref {
                        target: *target,
                        args: widened.into(),
                    }),
                    None => ty,
                }
            }
            _ => ty,
        }
    }

    /// `widen_nullish` of each of `types`. `None`: they all stay as they are.
    fn widen_nullish_each(&mut self, types: &[TypeId], depth: u32) -> Option<Vec<TypeId>> {
        let mut widened: Option<Vec<TypeId>> = None;
        for (i, &ty) in types.iter().enumerate() {
            let wide = self.widen_nullish(ty, depth + 1);
            if wide != ty {
                widened.get_or_insert_with(|| types.to_vec())[i] = wide;
            }
        }
        widened
    }

    fn widen_objects(&mut self, ty: TypeId, siblings: Option<&[TypeId]>) -> TypeId {
        if !self.contains_object_literal(ty, 0) {
            return ty;
        }
        match self.data(ty).clone() {
            TypeData::Union(parts) => {
                let siblings = siblings.unwrap_or(&parts);
                let widened: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| {
                        if self.is_nullish(p) {
                            p
                        } else {
                            self.widen_objects(p, Some(siblings))
                        }
                    })
                    .collect();
                // `{}` goes from having nothing to allowing anything.
                if widened.iter().any(|&w| self.is_empty_object_type(w)) {
                    self.union_reduced(&widened)
                } else {
                    self.union(&widened)
                }
            }
            TypeData::Intersection(parts) => {
                let widened: Vec<TypeId> =
                    parts.iter().map(|&p| self.widen_objects(p, None)).collect();
                self.intersection(&widened)
            }
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => {
                let widened: Vec<TypeId> =
                    elems.iter().map(|&e| self.widen_objects(e, None)).collect();
                self.tuple(&widened, &flags, readonly)
            }
            TypeData::Ref { target, args } => {
                let args: Vec<TypeId> = args.iter().map(|&a| self.widen_objects(a, None)).collect();
                self.intern(TypeData::Ref {
                    target,
                    args: args.into(),
                })
            }
            _ => self.widen_object_literal(ty, siblings),
        }
    }

    /// `undefinedType`: the `undefined` that is not widened. Without strictNullChecks that is not the one expressions give.
    pub(super) fn undefined_as_declared(&self) -> TypeId {
        if self.p.files.options.strict_null_checks {
            TypeId::UNDEFINED
        } else {
            TypeId::UNDEFINED_DECLARED
        }
    }

    /// `getWidenedTypeOfObjectLiteral`: every property is widened, and so is what is found under any key.
    fn widen_object_literal(&mut self, ty: TypeId, siblings: Option<&[TypeId]>) -> TypeId {
        let others: Vec<TypeId> = siblings
            .unwrap_or(&[])
            .iter()
            .copied()
            .filter(|&s| s != ty && self.is_object_literal_type(s))
            .collect();
        // `getWidenedProperty`: what is no plain property stays as it is.
        let as_they_are = PropFlags::METHOD | PropFlags::ACCESSOR;
        if others.is_empty() {
            match self.data(ty).clone() {
                TypeData::Anon {
                    origin: Origin::ObjectLiteral(file, e),
                    mapper,
                } => {
                    return self.intern(TypeData::Anon {
                        origin: Origin::WidenedLiteral(file, e),
                        mapper,
                    });
                }
                TypeData::Synth(shape) => {
                    let mut shape = *shape;
                    shape.literal = Literalness::No;
                    for prop in &mut shape.props {
                        if !prop.flags.intersects(as_they_are) {
                            prop.flags |= PropFlags::WIDEN;
                        }
                    }
                    for info in &mut shape.index {
                        info.value = self.regular_object(info.value);
                    }
                    return self.synth(shape);
                }
                _ => return ty,
            }
        }
        let Some(members) = self.members(ty) else {
            return ty;
        };
        let mut shape = Shape::default();
        for prop in &members.shape().props {
            let mut prop_ty = self.type_of_prop(prop, members.mapper);
            if !prop.flags.intersects(as_they_are) {
                if self.contains_object_literal(prop_ty, 0) {
                    // What the alternatives have under the same name are the alternatives to this.
                    let mut alternatives: Vec<TypeId> = self.parts(prop_ty).to_vec();
                    for &other in &others {
                        if let Some((p, mapper)) = self.prop_of(other, prop.name) {
                            let t = self.type_of_prop(&p, mapper);
                            alternatives.extend_from_slice(self.parts(t));
                        }
                    }
                    prop_ty = self.widen_objects(prop_ty, Some(&alternatives));
                }
                if !self.p.files.options.strict_null_checks {
                    prop_ty = self.widen_nullish(prop_ty, 0);
                }
            }
            shape.props.push(Prop {
                name: prop.name,
                flags: prop.flags,
                source: PropSource::Type(prop_ty),
                mapper: MapperId::IDENTITY,
            });
        }
        // `getUndefinedProperty`: `undefinedOrMissingType`, which is not widened again wherever it is copied to.
        let missing = if self.p.files.options.exact_optional_property_types {
            TypeId::MISSING
        } else {
            self.undefined_as_declared()
        };
        for &other in &others {
            if !self.is_closed_object_literal_type(other) {
                continue;
            }
            let Some(theirs) = self.members(other) else {
                continue;
            };
            for prop in &theirs.shape().props {
                if shape.prop(prop.name).is_none() {
                    shape.props.push(Prop {
                        name: prop.name,
                        // `createSymbolWithType`
                        flags: PropFlags::OPTIONAL | (prop.flags & PropFlags::READONLY),
                        source: PropSource::Type(missing),
                        mapper: MapperId::IDENTITY,
                    });
                }
            }
        }
        for info in &members.shape().index {
            let value = self.instantiate(info.value, members.mapper);
            let value = self.regular_object(value);
            shape.index.push(IndexInfo { value, ..*info });
        }
        self.synth(shape)
    }

    // ───────────────────────────── bindings ─────────────────────────────

    /// The type of what `pat` binds or destructures.
    pub fn type_of_pat(&mut self, file: FileId, pat: PatId) -> TypeId {
        if pat.is_none() {
            return TypeId::UNRESOLVED;
        }
        if let Some(known) = self.p.pat_types.get(file, pat.idx()) {
            return known;
        }
        if !self.enter(Query::Pat(file, pat)) {
            return if self.came_full_circle {
                TypeId::ANY
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.type_of_pat_uncached(file, pat);
        let ty = self.force(ty);
        let holds = self.leave();
        if self.left_a_circle {
            self.p.circular_pats.insert((file, pat), ());
            self.p.pat_types.set(file, pat.idx(), TypeId::ANY);
            return TypeId::ANY;
        }
        // `getTypeOfVariableOrParameterOrProperty`: what was settled meanwhile stands. Whoever asked is told what this came to.
        if holds && self.p.pat_types.get(file, pat.idx()).is_none() {
            self.p.pat_types.set(file, pat.idx(), ty);
        }
        ty
    }

    /// What the first to ask for the type of `pat` is told: `getTypeOfVariableOrParameterOrProperty` returns what it worked out, not
    /// what it kept. The two differ for a variable in a circle that goes through a call, which hides the first question from
    /// the second: the second is in the circle and settles on `any`, the first comes to what the initializer is.
    /// They also differ for a parameter whose first request resolves the enclosing call (`contextual_param_type_by_argument_index`).
    pub fn type_of_pat_as_first_asked(&mut self, file: FileId, pat: PatId) -> TypeId {
        if let Some(ty) = self.contextual_param_type_by_argument_index(file, pat) {
            return ty;
        }
        let ty = self.type_of_pat(file, pat);
        if self.p.circular_through_call.get(&(file, pat)).is_none() {
            return ty;
        }
        let ty = self.type_of_pat_uncached(file, pat);
        self.force(ty)
    }

    /// The result of `getTypeOfVariableOrParameterOrPropertyWorker` for a parameter of a function argument, when that request is
    /// the one that resolves the call. Resolving the call assigns the parameter its type through `getSpreadArgumentType`, which
    /// indexes a rest tuple from both ends. The worker then continues with `getContextualTypeForArgumentAtIndex`, which indexes
    /// it from the start only, and returns that result. The two differ only for a tuple whose variable element is not last.
    /// `None` if they agree, or if an earlier request has already resolved the call. Only `sites.rs` may depend on this.
    fn contextual_param_type_by_argument_index(
        &mut self,
        file: FileId,
        pat: PatId,
    ) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let param = &hir[p];
        if param.ty.is_some()
            || param.default.is_some()
            || param.flags.intersects(Flags::OPTIONAL | Flags::REST)
        {
            return None;
        }
        let func = bound.param_fn[p.idx()];
        let param_index = (p.0 - hir[func].params.start) as usize;
        // `isContextSensitiveFunctionOrObjectLiteralMethod`. An earlier parameter without an annotation is requested first.
        if !matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow)
            || !hir[func].type_params.is_empty()
            || hir[func]
                .params
                .iter()
                .take(param_index)
                .any(|q| hir[q].ty.is_none())
        {
            return None;
        }
        let FnOwner::Expr(arg) = bound.fns[func.idx()].owner else {
            return None;
        };
        let Parent::Expr(call) = bound.expr_parent[arg.idx()] else {
            return None;
        };
        let ExprKind::Call(c) = hir[call].kind else {
            return None;
        };
        let c = &hir[c];
        // `getQuickTypeOfExpression` answers for a call that is an expression statement or an initializer without resolving it.
        // Anywhere else the call is checked before the parameter is requested.
        let is_quick = match bound.expr_parent[call.idx()] {
            Parent::Stmt(stmt) => matches!(hir[stmt].kind, StmtKind::Expr(_)),
            Parent::VarInit(_) => true,
            _ => false,
        };
        if !is_quick || c.chain != Chain::No {
            return None;
        }
        let arg_index = hir.ids(c.args).position(|a| a == arg)?;
        // A parameter in an earlier context sensitive argument is requested first.
        if hir.ids(c.args).take(arg_index).any(|a| {
            matches!(hir[a].kind, ExprKind::Spread(_)) || self.is_context_sensitive(file, a)
        }) {
            return None;
        }
        // `getReturnTypeOfSingleNonGenericSignature`
        let callee = self.type_of_expr(file, c.callee);
        let sig = self.single_call_signature(callee, true)?;
        if !self.sig_type_params(sig).is_empty() {
            return None;
        }
        let params = self.sig_params(sig);
        let rest = params.last().filter(|last| last.rest)?.ty;
        let rest_index = params.len() - 1;
        if arg_index < rest_index {
            return None;
        }
        let rest = self.force(rest);
        let TypeData::Tuple { flags, .. } = self.data(rest) else {
            return None;
        };
        let variable = flags
            .iter()
            .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))?;
        if variable + 1 == flags.len() {
            return None;
        }
        let key = self.number_literal((arg_index - rest_index) as f64, false);
        let context = self.indexed_access_if_any(rest, key, false)?;
        // `getContextuallyTypedParameterType`. Without a contextual signature the parameter is an implicit `any`.
        let Some(contextual) = self.contextual_signature_in(file, func, context) else {
            return Some(TypeId::ANY);
        };
        let params = self.sig_params(contextual);
        Some(
            self.param_type_at(&params, param_index)
                .unwrap_or(TypeId::ANY),
        )
    }

    /// Whether what `pat` is part of has its type written out.
    fn pattern_is_annotated(&self, file: FileId, mut pat: PatId) -> bool {
        loop {
            match self.bound(file).pat_parent[pat.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pat = parent,
                PatParent::Var(d) => return self.hir(file)[d].ty.is_some(),
                PatParent::Param(p) => return self.hir(file)[p].ty.is_some(),
                PatParent::None => return false,
            }
        }
    }

    /// `checkDeclarationInitializer`: `getQuickTypeOfExpression` comes first. Where the call goes through the two agree, so it only
    /// shows for a `new` that is refused (abstract, a constructor out of reach): that is what the one construct signature returns,
    /// if it is not generic, whatever is wrong with the call.
    pub(super) fn type_of_declaration_initializer(&mut self, file: FileId, e: ExprId) -> TypeId {
        let ty = self.type_of_expr(file, e);
        if ty != TypeId::ANY {
            return ty;
        }
        let hir = self.hir(file);
        let ExprKind::New(call) = hir[e].kind else {
            return ty;
        };
        let callee = self.type_of_expr(file, hir[call].callee);
        // `getSingleSignature`
        if !self.is_object_type(callee) || !self.signatures(callee, false).is_empty() {
            return ty;
        }
        let sigs = self.signatures(callee, true);
        let &[only] = &sigs[..] else { return ty };
        if !self.sig_type_params(only).is_empty() {
            return ty;
        }
        self.sig_return(only)
    }

    /// The tail of `getBindingElementTypeFromParentType`: what `pat`, an element of a pattern, is bound to when `ty` is what is found for
    /// it and `default` what it gets if there is nothing.
    fn with_default(&mut self, file: FileId, pat: PatId, ty: TypeId, default: ExprId) -> TypeId {
        if default.is_none() {
            return ty;
        }
        // What is declared stands: the default only sees to it that it is not missing. Where that is not told apart the default
        // is not looked at.
        let is_annotated = self.pattern_is_annotated(file, pat);
        if is_annotated && !self.p.files.options.strict_null_checks {
            return ty;
        }
        let default_ty = self.type_of_declaration_initializer(file, default);
        // `checkDeclarationInitializer`: below a parameter a default may as well have what its own pattern has defaults for.
        let default_ty = if self.pattern_root_is_param(file, pat) {
            self.padded_for_pattern(file, pat, default_ty)
        } else {
            default_ty
        };
        if is_annotated {
            // `TypeFactsIsUndefined`
            let may_be_missing = self.some_type(default_ty, |c, m| m.is_undefined() || c.is_any(m));
            return if may_be_missing {
                ty
            } else {
                self.non_undefined_type(ty)
            };
        }
        if self.is_any(ty) {
            return ty;
        }
        // `widenTypeInferredFromInitializer`, of both together: a default that is one of the literals there are is not widened.
        let present = self.non_undefined_type(ty);
        let whole = self.union_reduced(&[present, default_ty]);
        if self.hir(file).is_js && self.is_empty_array_literal_type(file, default, whole) {
            return self.array_of(TypeId::ANY);
        }
        if self.pattern_is_constant(file, pat) {
            whole
        } else {
            self.widen_literal(whole)
        }
    }

    /// `isEmptyArrayLiteralType` of `ty`, which was computed from the expression `e`. There is no `implicitNeverType` here, so `e`
    /// has to be written `[]` and `ty` has to be its array type. `widenTypeInferredFromInitializer` makes such a type `any[]` in
    /// a JavaScript file.
    fn is_empty_array_literal_type(&mut self, file: FileId, e: ExprId, ty: TypeId) -> bool {
        matches!(self.hir(file)[e].kind, ExprKind::Array(items) if items.is_empty())
            && self.is_array(ty)
            && ty == self.type_of_expr(file, e)
    }

    /// `getNonUndefinedType`: `ty` without `undefined`. If what some member that waits for a type parameter extends can be
    /// `undefined`, every such member gives way to what it extends first.
    pub(super) fn non_undefined_type(&mut self, ty: TypeId) -> TypeId {
        // `isGenericTypeWithUndefinedConstraint`
        let mut gives_way = false;
        for &m in self.parts(ty) {
            if self.is_deferred(m)
                && let Some(constraint) = self.base_constraint_of(m)
                && self.contains_undefined(constraint)
            {
                gives_way = true;
                break;
            }
        }
        let ty = if gives_way {
            self.map_type(ty, |c, m| {
                if c.is_deferred(m) {
                    c.base_constraint_of(m).unwrap_or(m)
                } else {
                    m
                }
            })
        } else {
            ty
        };
        // `TypeFactsNEUndefined`, which `void` does not have either.
        self.filter(ty, |_, m| !m.is_undefined() && m != TypeId::VOID)
    }

    fn pattern_is_constant(&self, file: FileId, mut pat: PatId) -> bool {
        loop {
            match self.bound(file).pat_parent[pat.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pat = parent,
                PatParent::Var(d) => {
                    return matches!(
                        self.hir(file)[d].kind,
                        VarKind::Const | VarKind::Using | VarKind::AwaitUsing
                    );
                }
                PatParent::Param(_) | PatParent::None => return false,
            }
        }
    }

    /// `IsParameterDeclaration(GetRootDeclaration(..))`: whether what `pat` is part of is a parameter.
    pub(super) fn pattern_root_is_param(&self, file: FileId, mut pat: PatId) -> bool {
        loop {
            match self.bound(file).pat_parent[pat.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pat = parent,
                PatParent::Param(_) => return true,
                PatParent::Var(_) | PatParent::None => return false,
            }
        }
    }

    fn type_of_pat_uncached(&mut self, file: FileId, pat: PatId) -> TypeId {
        let hir = self.hir(file);
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::None => TypeId::UNRESOLVED,
            PatParent::Var(d) => self.type_of_var_decl(file, d),
            PatParent::Param(p) => self.type_of_param_uncached(file, p),
            PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => {
                let parent_ty = self.type_for_binding_element_parent(file, pat, parent);
                let ty = self.type_of_binding_element(file, pat, parent_ty);
                // What is taken apart is not widened; what comes out of it, once it has a name, is.
                if !matches!(hir[pat].kind, PatKind::Ident(_)) {
                    return ty;
                }
                // `getTupleElementTypeOutOfStartCount`: past the end of a tuple is an `undefined` that does not widen.
                if ty == TypeId::UNDEFINED
                    && let PatParent::Elem(_, elem) = self.bound(file).pat_parent[pat.idx()]
                    && hir[elem].default.is_none()
                    && !hir[elem].is_rest
                    && let PatKind::Array(elems) = hir[parent].kind
                    && let TypeData::Tuple {
                        elems: have, flags, ..
                    } = self.data(parent_ty)
                    && !flags
                        .iter()
                        .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                    && (elem.0 - elems.start) as usize >= have.len()
                {
                    return self.undefined_as_declared();
                }
                self.widened_for_declaration(ty)
            }
        }
    }

    /// `getTypeForBindingElementParent`: what the pattern `parent` takes apart, for its element `pat`.
    pub(super) fn type_for_binding_element_parent(
        &mut self,
        file: FileId,
        pat: PatId,
        parent: PatId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_rest = match bound.pat_parent[pat.idx()] {
            PatParent::Prop(_, prop) => hir[prop].is_rest,
            PatParent::Elem(_, elem) => hir[elem].is_rest,
            _ => false,
        };
        let ty = match bound.pat_parent[parent.idx()] {
            // Without the `undefined` that `?` adds. One that is written stays.
            PatParent::Param(p)
                if hir[p].ty.is_some() && hir[p].flags.contains(Flags::OPTIONAL) =>
            {
                self.type_from_node(file, hir[p].ty)
            }
            // The default as it is, not widened. Only the parameters of function expressions and of what is written in object literals
            // are typed (`assignParameterType`, widened) before their patterns are looked at. Of a setter the getter says.
            PatParent::Param(p)
                if hir[p].ty.is_none()
                    && hir[p].default.is_some()
                    && hir[bound.param_fn[p.idx()]].kind != FnKind::Setter
                    && !matches!(
                        bound.fns[bound.param_fn[p.idx()].idx()].owner,
                        FnOwner::Expr(_)
                    ) =>
            {
                self.type_from_param_default(file, p)
            }
            // `CheckModeRestBindingElement`: for `...rest` the initializer is looked at again, the pattern being no reason to give up
            // on a type parameter.
            PatParent::Var(d) if is_rest && hir[d].ty.is_none() && hir[d].init.is_some() => {
                match self.type_of_reference_for_rest(file, hir[d].init) {
                    Some(ty) => ty,
                    None => return self.type_of_pat(file, parent),
                }
            }
            _ => return self.type_of_pat(file, parent),
        };
        self.force(ty)
    }

    /// The head of `getBindingElementTypeFromParentType`: what `pattern` takes apart, given that what it stands for is a `ty`. Where
    /// `null` and `undefined` are told apart, a parameter of something that is only declared is taken to be there, and what has an
    /// initializer that cannot be `undefined` is not `undefined`.
    pub(super) fn type_pattern_takes_apart(
        &mut self,
        file: FileId,
        pattern: PatId,
        ty: TypeId,
    ) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        let has_nullish = self.some_type(ty, |c, m| c.is_nullish(m));
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `IsPartOfParameterDeclaration`
        let mut root = pattern;
        while let PatParent::Prop(parent, _) | PatParent::Elem(parent, _) =
            bound.pat_parent[root.idx()]
        {
            root = parent;
        }
        if let PatParent::Param(p) = bound.pat_parent[root.idx()] {
            // `NodeFlagsAmbient`
            let mut is_ambient = hir.kind == FileKind::Declaration;
            let mut scope = bound.fns[bound.param_fn[p.idx()].idx()].scope;
            while !is_ambient && scope.is_some() {
                let s = &bound.scopes[scope.idx()];
                is_ambient = match s.kind {
                    ScopeKind::Module(m) => hir[m].flags.contains(Flags::AMBIENT),
                    ScopeKind::Fn(f) => hir[f].flags.contains(Flags::AMBIENT),
                    ScopeKind::Class(c) => hir[c].flags.contains(Flags::AMBIENT),
                    _ => false,
                };
                scope = s.parent;
            }
            if is_ambient {
                return if has_nullish {
                    self.non_nullable(ty)
                } else {
                    ty
                };
            }
        }
        let initializer = match bound.pat_parent[pattern.idx()] {
            PatParent::Var(d) => hir[d].init,
            PatParent::Param(p) => hir[p].default,
            PatParent::Prop(_, prop) => hir[prop].default,
            PatParent::Elem(_, elem) => hir[elem].default,
            PatParent::None => ExprId::NONE,
        };
        if initializer.is_none() {
            return ty;
        }
        // `getTypeOfInitializer` is asked whatever `ty` is: an initializer that reads a name of the pattern is a circle.
        let uncertain = self.uncertain;
        let given = self.type_of_expr(file, initializer);
        // `TypeFactsNEUndefined`, which `void` does not have either.
        if !self.some_type(ty, |_, m| m.is_undefined() || m == TypeId::VOID) {
            self.uncertain = uncertain;
            return ty;
        }
        if self.may_be_undefined(given) {
            return ty;
        }
        self.filter(ty, |_, m| !m.is_undefined() && m != TypeId::VOID)
    }

    /// `TypeFactsEQUndefined`, where `null` and `undefined` are told apart: whether a `ty` can be `undefined`.
    fn may_be_undefined(&mut self, ty: TypeId) -> bool {
        for &m in self.parts(ty) {
            let may_be = match self.data(m) {
                // It has to be all of them at once.
                TypeData::Intersection(members) => {
                    members.iter().all(|&m| self.may_be_undefined(m))
                }
                // What it extends says; if nothing is known of that, it can be anything.
                _ if self.is_deferred(m) => {
                    let constraint = self.base_constraint(m);
                    self.is_deferred(constraint) || self.may_be_undefined(constraint)
                }
                _ => {
                    self.is_any(m) || m == TypeId::UNKNOWN || m.is_undefined() || m == TypeId::VOID
                }
            };
            if may_be {
                return true;
            }
        }
        false
    }

    /// `getBindingElementTypeFromParentType`: what `pat`, an element of a pattern, is bound to when what the pattern destructures is a
    /// `parent_ty`.
    pub(super) fn type_of_binding_element(
        &mut self,
        file: FileId,
        pat: PatId,
        parent_ty: TypeId,
    ) -> TypeId {
        // Out of anything comes anything, and nothing else is looked at: no default either.
        if self.is_any(parent_ty) {
            return parent_ty;
        }
        let hir = self.hir(file);
        let parent_ty = match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => {
                self.type_pattern_takes_apart(file, parent, parent_ty)
            }
            _ => parent_ty,
        };
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::None | PatParent::Var(_) | PatParent::Param(_) => TypeId::UNRESOLVED,
            PatParent::Prop(parent, prop) => {
                let prop = &hir[prop];
                if prop.is_rest {
                    let PatKind::Object(props) = hir[parent].kind else {
                        return TypeId::UNRESOLVED;
                    };
                    let parent_ty = self.reduced(parent_ty);
                    // 2700, and what is in error is anything.
                    if self.is_rest_of_invalid_type(parent_ty) {
                        return TypeId::ANY;
                    }
                    // `getLiteralTypeFromPropertyName`: a name that is worked out and is not the name of one property stands for
                    // whatever its type allows. One that reads as a number is the number or the string, whichever is written, and
                    // leaves out a property named by the same.
                    let (mut omitted, mut keys) = (Vec::new(), Vec::new());
                    for p in props.iter() {
                        if hir[p].is_rest {
                            continue;
                        }
                        match self.member_name(file, hir[p].key) {
                            Some(name) if self.is_numeric_name(name) => match hir[p].key {
                                PropKey::Computed(e) => {
                                    let key = self.type_of_expr(file, e);
                                    keys.push(self.regular(key));
                                }
                                _ if self.is_written_as_number(file, hir[p].pos) => {
                                    keys.extend(self.key_type_of_name(name))
                                }
                                _ => keys.push(self.string_literal(name, false)),
                            },
                            Some(name) => omitted.push(name),
                            None => {
                                if let PropKey::Computed(e) = hir[p].key {
                                    let key = self.type_of_expr(file, e);
                                    keys.push(self.regular(key));
                                }
                            }
                        }
                    }
                    let keys = self.union(&keys);
                    let ty = self.rest_of_object(parent_ty, &omitted, keys);
                    return self.with_default(file, pat, ty, prop.default);
                }
                // `AccessFlagsAllowMissing`: with a default, what an object literal does not mention is `undefined`.
                let allows_missing =
                    prop.default.is_some() && self.is_object_literal_type(parent_ty);
                let missing = self.undefined_as_declared();
                let ty = match self.member_name(file, prop.key) {
                    Some(name) => {
                        // `getPropertyTypeForIndexType`: a numeric name of a tuple is an element, `undefined` past the end of a
                        // fixed tuple, and never what the number index signature gives.
                        let is_tuple_element = self.is_numeric_name(name)
                            && self.every_type(parent_ty, |c, m| c.is_tuple(m));
                        let property = if is_tuple_element {
                            None
                        } else {
                            self.type_of_property(parent_ty, name)
                        };
                        match property {
                            Some(ty) => ty,
                            None => {
                                let key = self.string_literal(name, false);
                                match self.indexed_access_if_any(parent_ty, key, true) {
                                    Some(ty) => ty,
                                    None if allows_missing => missing,
                                    // An error, and what is in error is anything.
                                    None if self.is_known(parent_ty) => TypeId::ANY,
                                    None => TypeId::UNRESOLVED,
                                }
                            }
                        }
                    }
                    None => match prop.key {
                        PropKey::Computed(e) => {
                            let key = self.type_of_expr(file, e);
                            let key = self.regular(key);
                            match self.indexed_access_if_any(parent_ty, key, true) {
                                // `getPropertyTypeForIndexType`: that a key of type `any` finds anything comes after what may be missing.
                                Some(TypeId::ANY)
                                    if allows_missing
                                        && key == TypeId::ANY
                                        && self
                                            .members(parent_ty)
                                            .is_some_and(|m| m.shape().index.is_empty()) =>
                                {
                                    missing
                                }
                                Some(ty) => ty,
                                // Each member of the key is looked up by itself.
                                None if allows_missing => {
                                    let mut types = Vec::new();
                                    for &k in self.parts(key) {
                                        types.push(
                                            self.indexed_access_if_any(parent_ty, k, true)
                                                .unwrap_or(missing),
                                        );
                                    }
                                    self.union(&types)
                                }
                                // An error, and what is in error is anything.
                                None if self.is_known(parent_ty) && self.is_known(key) => {
                                    TypeId::ANY
                                }
                                None => TypeId::UNRESOLVED,
                            }
                        }
                        _ => TypeId::UNRESOLVED,
                    },
                };
                let ty = self.narrow_destructured(file, pat, ty);
                self.with_default(file, pat, ty, prop.default)
            }
            PatParent::Elem(parent, elem) => {
                let PatKind::Array(elems) = hir[parent].kind else {
                    return TypeId::UNRESOLVED;
                };
                let index = (elem.0 - elems.start) as usize;
                let e = &hir[elem];
                let ty = self.element_of_destructured(parent_ty, index, e.is_rest);
                let ty = self.narrow_destructured(file, pat, ty);
                self.with_default(file, pat, ty, e.default)
            }
        }
    }

    /// `isArrayLikeType`
    pub(super) fn is_array_like(&mut self, ty: TypeId) -> bool {
        if self.is_array_or_tuple(ty) {
            return true;
        }
        if ty.is_undefined() || ty.is_null() {
            return false;
        }
        let any_list = self.readonly_array_of(TypeId::ANY);
        self.is_assignable(ty, any_list)
    }

    /// `getBindingElementTypeFromParentType`, for an array pattern: element `index` of what is destructured; from `index` on if `rest`.
    pub fn element_of_destructured(&mut self, ty: TypeId, index: usize, rest: bool) -> TypeId {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return ty;
        }
        // `getReducedType`: an intersection nothing can be is `never`, and drops out of a union.
        let ty = self.reduced(ty);
        // `getReducedApparentType`: a type parameter is looked into as what it extends.
        let apparent = if self.is_deferred(ty) {
            let apparent = self.apparent_type(ty);
            self.reduced(apparent)
        } else {
            ty
        };
        // `never` cannot be gone through, which is an error: anything. Yet it passes for a list, and `never[0]` is `never`.
        if apparent == TypeId::NEVER {
            return if rest {
                self.array_of(TypeId::ANY)
            } else {
                TypeId::NEVER
            };
        }
        if rest {
            // What is a tuple, or extends one, is cut (`sliceTupleType`). Of anything else it is an array of what the whole yields.
            let constraint = self.map_type(ty, |c, m| {
                if c.is_deferred(m) {
                    c.base_constraint_of(m).unwrap_or(m)
                } else {
                    m
                }
            });
            if self.every_type(constraint, |c, m| c.is_tuple(m)) {
                return self.map_type(constraint, |c, m| match c.data(m) {
                    TypeData::Tuple { elems, flags, .. } => c.slice_tuple(elems, flags, index, 0),
                    _ => m,
                });
            }
            let element = self.iterated_type(ty, false);
            return self.array_of(element);
        }
        // Only of a list are elements looked up by number: `interface RegExpExecArray extends Array<string> { 0: string }`.
        // Nothing there is an error, and what is in error is anything.
        if self.is_array_like(ty) {
            let key = self.number_literal(index as f64, false);
            return self
                .indexed_access_if_any(ty, key, true)
                .unwrap_or(TypeId::ANY);
        }
        // Of anything else it is what the whole yields, if it gets that far (`includeUndefinedInIndexSignature`).
        let element = self.iterated_type(ty, false);
        if self.p.files.options.no_unchecked_indexed_access {
            self.optional(element)
        } else {
            element
        }
    }

    /// `getBindingElementTypeFromParentType`: whether no `...rest` can be taken out of a `parent_ty`, which is 2700: it is `unknown`,
    /// or not `isValidSpreadType`.
    pub(super) fn is_rest_of_invalid_type(&mut self, parent_ty: TypeId) -> bool {
        if !self.is_known(parent_ty) {
            return false;
        }
        let reduced = self.reduced(parent_ty);
        reduced == TypeId::UNKNOWN || !self.is_valid_spread_type(reduced)
    }

    /// Whether the name of a property, which starts at `pos` of `file`, is written as a number: `0`, `.5`, `[0]`.
    pub(super) fn is_written_as_number(&self, file: FileId, pos: u32) -> bool {
        let text = &self.hir(file).text;
        let at = pos as usize;
        let first = match text.get(at) {
            // A computed name starts with its bracket.
            Some(b'[') => text[at + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace() && **b != b'('),
            first => first,
        };
        matches!(first, Some(b'0'..=b'9' | b'.'))
    }

    /// `getRestType`, what `...rest` gets: `ty` without the properties `omitted` and without those whose name is an `omitted_keys`,
    /// the types of the names that are left out by type: the computed ones that are not the name of one property, and those that
    /// read as numbers (`never`: there are none).
    pub fn rest_of_object(&mut self, ty: TypeId, omitted: &[Atom], omitted_keys: TypeId) -> TypeId {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return ty;
        }
        if !self.is_known(omitted_keys) {
            return TypeId::UNRESOLVED;
        }
        let ty = self.filter(ty, |_, m| !m.is_null() && !m.is_undefined());
        if ty == TypeId::NEVER {
            return TypeId::EMPTY_OBJECT;
        }
        if self.is_union(ty) {
            return self.map_type(ty, |c, m| c.rest_of_object(m, omitted, omitted_keys));
        }
        // `getPropertiesOfType`: a type parameter has what it extends has.
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        let members = self.members(apparent);
        // Which properties go into the rest, and the names of the others.
        let (mut kept, mut left_out): (Vec<usize>, Vec<TypeId>) = (Vec::new(), Vec::new());
        if let Some(members) = &members {
            for (i, prop) in members.shape().props.iter().enumerate() {
                // `getLiteralTypeFromProperty`: what is not public, or goes by a `#name`, has no name to be left out by.
                if prop
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                {
                    continue;
                }
                let Some(key) = self.key_type_of_prop(apparent, prop) else {
                    continue;
                };
                let is_omitted = omitted.contains(&prop.name)
                    || omitted_keys != TypeId::NEVER && self.is_assignable(key, omitted_keys);
                if !is_omitted && self.is_spreadable_property(prop) {
                    kept.push(i);
                } else {
                    left_out.push(key);
                }
            }
        }
        // `isGenericObjectType`, `isGenericIndexType`
        let mut is_generic = self.is_generic(ty);
        for &key in self.parts(omitted_keys) {
            is_generic |= !self.is_pattern_literal(key) && self.is_generic(key);
        }
        if is_generic {
            // `Omit<T, "a" | K>`, and what could not go into the rest is left out by name as well.
            let mut keys: Vec<TypeId> = Vec::with_capacity(omitted.len() + 1 + left_out.len());
            for &name in omitted {
                keys.extend(self.key_type_of_name(name));
            }
            keys.push(omitted_keys);
            keys.extend(left_out);
            let keys = self.union(&keys);
            if keys == TypeId::NEVER {
                return ty;
            }
            // Without an `Omit` it is an error, and what is in error can be anything.
            let Some(omit) = self.global_type_symbol(known::Omit) else {
                return TypeId::ANY;
            };
            return self.type_reference(omit, &[ty, keys]);
        }
        let Some(members) = members else {
            return TypeId::EMPTY_OBJECT;
        };
        let mut shape = Shape::default();
        for i in kept {
            let prop = &members.shape().props[i];
            // `getSpreadSymbol`: reading what can only be set gives nothing.
            let ty = if prop.flags.contains(PropFlags::WRITE_ONLY) {
                self.undefined_as_declared()
            } else {
                self.type_of_prop(prop, members.mapper)
            };
            shape.props.push(Prop {
                name: prop.name,
                // A copy: what could not be written to in the original can be in it.
                flags: prop.flags & (PropFlags::OPTIONAL | PropFlags::STRING_NAME),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            });
        }
        for info in &members.shape().index {
            let value = self.instantiate(info.value, members.mapper);
            shape.index.push(IndexInfo { value, ..*info });
        }
        self.synth(shape)
    }

    /// `checkNonNullType`, less what it reports: `ty` without `null` and `undefined`. `unknown`, or nothing left, is an error: anything.
    fn non_null_type(&mut self, ty: TypeId) -> TypeId {
        // Without strictNullChecks `GetNonNullableType` returns its argument, so only `null` and `undefined` themselves are errors.
        if !self.p.files.options.strict_null_checks {
            return if ty.is_undefined() || ty.is_null() {
                TypeId::ANY
            } else {
                ty
            };
        }
        if ty == TypeId::UNKNOWN {
            return TypeId::ANY;
        }
        // `GetNonNullableType` changes every type that has one of `TypeFactsIsUndefinedOrNull`.
        let rest = self.non_nullable_type_if_needed(ty);
        if rest == ty {
            return ty;
        }
        if rest == TypeId::NEVER || self.every_type(rest, |_, m| m.is_undefined() || m.is_null()) {
            TypeId::ANY
        } else {
            rest
        }
    }

    /// `getTypeForVariableLikeDeclaration`, and `widenTypeForVariableLikeDeclaration` of that if the variable has a name: what a
    /// pattern takes apart is not widened (`getTypeForBindingElementParent`).
    fn type_of_var_decl(&mut self, file: FileId, d: VarDeclId) -> TypeId {
        let hir = self.hir(file);
        let decl = &hir[d];
        let is_name = matches!(hir[decl.pat].kind, PatKind::Ident(_));
        let is_constant = matches!(
            decl.kind,
            VarKind::Const | VarKind::Using | VarKind::AwaitUsing
        );
        // The statement is the `try` for a catch variable, and the head of the loop for a loop variable.
        let stmt = self.bound(file).var_stmt[d.idx()];
        let around = if stmt.is_some() {
            self.bound(file).stmt_parent[stmt.idx()]
        } else {
            Parent::None
        };
        // What the loop goes through decides, whatever is written after the name.
        if let Parent::Stmt(parent) = around {
            match hir[parent].kind {
                StmtKind::ForIn { left, expr, .. } if left == stmt => {
                    // `for (let v in v)`: what it is depends on what it is.
                    let own = self.bound(file).pat_symbol[decl.pat.idx()];
                    if own.is_some()
                        && matches!(hir[expr].kind, ExprKind::Ident(_))
                        && self.bound(file).expr_symbol[expr.idx()] == own
                    {
                        return TypeId::ANY;
                    }
                    // The keys of something generic are its own, those that are strings.
                    let object = self.type_of_expr(file, expr);
                    let object = self.non_nullable_type_if_needed(object);
                    let keys = self.keyof(object);
                    if matches!(
                        self.data(keys),
                        TypeData::Keyof(_) | TypeData::TypeParam(..)
                    ) && let Some(name) = self.files().atoms.lookup(b"Extract")
                        && let Some(extract) = self.files().global(name, SymFlags::TYPE_ALIAS)
                    {
                        return self.type_reference(extract, &[keys, TypeId::STRING]);
                    }
                    return TypeId::STRING;
                }
                // `checkRightHandSideOfForOf`
                StmtKind::ForOf {
                    left,
                    expr,
                    is_await,
                    ..
                } if left == stmt => {
                    let iterable = self.type_of_expr(file, expr);
                    let iterable = self.non_null_type(iterable);
                    let element = self.iterated_type(iterable, is_await);
                    return if is_name {
                        self.widened_for_declaration(element)
                    } else {
                        element
                    };
                }
                _ => {}
            }
        }
        // What is caught can only be said to be `any` or `unknown`.
        if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. }) {
            if decl.ty.is_none() {
                return if self.p.files.options.use_unknown_in_catch_variables {
                    TypeId::UNKNOWN
                } else {
                    TypeId::ANY
                };
            }
            let declared = self.type_from_node(file, decl.ty);
            let declared = self.force(declared);
            return if matches!(declared, TypeId::ANY | TypeId::UNKNOWN | TypeId::UNRESOLVED) {
                declared
            } else {
                TypeId::ANY
            };
        }
        // `isValidESSymbolDeclaration`: a `const` with a name, in a statement of its own. To anything else a `unique symbol` is a `symbol`.
        let unique_symbol_name = match hir[decl.pat].kind {
            PatKind::Ident(name)
                if decl.kind == VarKind::Const
                    && stmt.is_some()
                    && matches!(hir[stmt].kind, StmtKind::Var(_))
                    && !matches!(around, Parent::Stmt(parent) if matches!(hir[parent].kind, StmtKind::For { init, .. } if init == stmt)) =>
            {
                Some(name)
            }
            _ => None,
        };
        if decl.ty.is_some() {
            if matches!(hir[decl.ty].kind, TypeNodeKind::UniqueSymbol)
                && let Some(name) = unique_symbol_name
            {
                return self.intern(TypeData::UniqueSymbol {
                    file,
                    id: decl.ty.0,
                    name,
                });
            }
            return self.type_from_node(file, decl.ty);
        }
        if decl.init.is_none() {
            // `getTypeFromBindingPattern`: what the pattern itself implies.
            return if is_name {
                TypeId::ANY
            } else {
                self.type_implied_by_pattern(file, decl.pat)
                    .unwrap_or(TypeId::ANY)
            };
        }
        // `const s = Symbol()`
        if let Some(name) = unique_symbol_name
            && let ExprKind::Call(c) = hir[decl.init].kind
        {
            let callee = match hir[hir[c].callee].kind {
                ExprKind::Dot { obj, name, .. } if self.files().atoms.bytes(name) == b"for" => obj,
                _ => hir[c].callee,
            };
            // `isSymbolOrSymbolForCall`: it has to be the global value of that name, and there has to be one.
            if matches!(hir[callee].kind, ExprKind::Ident(known::Symbol))
                && self.bound(file).expr_symbol[callee.idx()].is_none()
                && self
                    .files()
                    .global(known::Symbol, SymFlags::VALUE)
                    .is_some()
            {
                return self.intern(TypeData::UniqueSymbol {
                    file,
                    id: decl.init.0 | 1 << 31,
                    name,
                });
            }
        }
        // Where an implicit `any` is an error, a variable written with `null` or `undefined` is the `any`, and one written with `[]`
        // the `any[]`, of which control flow says what it holds at a place. It goes by how the initializer is written, not by its type.
        if self.p.files.options.no_implicit_any
            && is_name
            && !decl.flags.intersects(Flags::EXPORT | Flags::AMBIENT)
            && hir.kind != FileKind::Declaration
        {
            match hir[decl.init].kind {
                // `isNullOrUndefined`
                ExprKind::Null if !is_constant => return TypeId::ANY,
                ExprKind::Ident(known::undefined)
                    if !is_constant && self.bound(file).expr_symbol[decl.init.idx()].is_none() =>
                {
                    return TypeId::ANY;
                }
                // `isEmptyArrayLiteral`, which does not look into parentheses.
                ExprKind::Array(items)
                    if items.is_empty()
                        && hir
                            .parens
                            .binary_search_by_key(&decl.init.0, |p| p.0.0)
                            .is_err() =>
                {
                    return self.array_of(TypeId::ANY);
                }
                _ => {}
            }
        }
        let ty = self.type_of_declaration_initializer(file, decl.init);
        // `getWidenedLiteralTypeForInitializer`
        let ty = if is_constant {
            ty
        } else {
            self.widen_literal(ty)
        };
        // `widenTypeInferredFromInitializer`
        if hir.is_js && self.is_empty_array_literal_type(file, decl.init, ty) {
            return self.array_of(TypeId::ANY);
        }
        if is_name {
            self.widened_for_declaration(ty)
        } else {
            ty
        }
    }

    pub fn type_of_param(&mut self, file: FileId, p: ParamId) -> TypeId {
        self.type_of_pat(file, self.hir(file)[p].pat)
    }

    fn type_of_param_uncached(&mut self, file: FileId, p: ParamId) -> TypeId {
        let hir = self.hir(file);
        let param = &hir[p];
        if param.ty.is_some() {
            let ty = self.type_from_node(file, param.ty);
            // `isOptionalDeclaration`: the `?` decides, default or no default.
            if param.flags.contains(Flags::OPTIONAL) {
                return self.optional(ty);
            }
            return ty;
        }
        let func = self.bound(file).param_fn[p.idx()];
        let index = (p.0 - hir[func].params.start) as usize;
        // The getter says.
        if hir[func].kind == FnKind::Setter
            && let Some(getter) = self.sibling_accessor(file, func, FnKind::Getter)
        {
            let ty = self.return_type_of_fn(file, getter);
            return self.widened_for_declaration(ty);
        }
        // `getContextuallyTypedParameterType`, `isContextSensitiveFunctionOrObjectLiteralMethod`: of a setter nothing is expected.
        if hir[func].kind != FnKind::Setter
            && let Some(mut ty) = self.contextual_param_type(file, func, index)
        {
            // `assignParameterType`: if `unknown` is all that is expected, the pattern says what it is.
            if ty == TypeId::UNKNOWN && !matches!(hir[param.pat].kind, PatKind::Ident(_)) {
                return self.type_implied_by_pattern(file, param.pat).unwrap_or(ty);
            }
            if param.default.is_none() {
                return if param.flags.contains(Flags::OPTIONAL) {
                    self.optional(ty)
                } else {
                    ty
                };
            }
            // `assignContextualParameterTypes`: a default that does not fit what is expected decides, if what is expected fits what
            // the default widens to. Of a function called where it is written no signature is expected.
            if !param.flags.contains(Flags::REST) && !self.is_immediately_invoked(file, func) {
                // TypeScript does this when it gets to the function, not while it resolves the parameter: a default that leads back to
                // the parameter is no circle there.
                self.eager.push(self.stack.len());
                let given = self.type_of_declaration_initializer(file, param.default);
                let given = self.padded_for_pattern(file, param.pat, given);
                if self.is_known(given) && self.is_known(ty) && !self.is_assignable(given, ty) {
                    let widened = self.widen_literal(given);
                    if self.is_assignable(ty, widened) {
                        ty = widened;
                    }
                }
                self.eager.pop();
            }
            // What the default rules out is ruled out where the parameter is read or taken apart.
            return ty;
        }
        if param.default.is_some() {
            let ty = self.type_from_param_default(file, p);
            let ty = self.widened_for_declaration(ty);
            // `addOptionalityEx`
            return if param.flags.contains(Flags::OPTIONAL) {
                self.optional(ty)
            } else {
                ty
            };
        }
        // `getTypeFromBindingPattern`, of a rest parameter too: `any[]` is for one of which nothing at all is known.
        if let Some(implied) = self.type_implied_by_pattern(file, param.pat) {
            return implied;
        }
        if param.flags.contains(Flags::REST) {
            return self.array_of(TypeId::ANY);
        }
        TypeId::ANY
    }

    /// `widenTypeInferredFromInitializer` of `checkDeclarationInitializer`: what its default makes of the parameter `p`, which says
    /// nothing itself and of which nothing is expected.
    fn type_from_param_default(&mut self, file: FileId, p: ParamId) -> TypeId {
        let param = &self.hir(file)[p];
        let ty = self.type_of_declaration_initializer(file, param.default);
        let ty = self.padded_for_pattern(file, param.pat, ty);
        if self.hir(file).is_js && self.is_empty_array_literal_type(file, param.default, ty) {
            return self.array_of(TypeId::ANY);
        }
        self.widen_literal(ty)
    }

    /// `padObjectLiteralType`, `padTupleType`: `ty`, the default of a parameter or of a part of one that `pat` takes apart, may as
    /// well have what the pattern has defaults of its own for.
    pub(super) fn padded_for_pattern(&mut self, file: FileId, pat: PatId, ty: TypeId) -> TypeId {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Object(props) if self.is_object_literal_type(ty) => {
                let Some(members) = self.members(ty) else {
                    return ty;
                };
                let mut missing = Vec::new();
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.default.is_some()
                        && !prop.is_rest
                        && let Some(name) = self.member_name(file, prop.key)
                        && members.shape().prop(name).is_none()
                    {
                        missing.push((name, prop.value, prop.default));
                    }
                }
                if missing.is_empty() {
                    return ty;
                }
                // It is the kind of literal it was: with something spread into it, what else it has is still not known.
                let literal = match self.data(ty) {
                    TypeData::Synth(shape) => shape.literal,
                    _ => Literalness::Literal,
                };
                let mut shape = Shape {
                    literal,
                    ..Shape::default()
                };
                for prop in &members.shape().props {
                    let ty = self.type_of_prop(prop, members.mapper);
                    shape.props.push(Prop {
                        name: prop.name,
                        flags: prop.flags,
                        source: PropSource::Type(ty),
                        mapper: MapperId::IDENTITY,
                    });
                }
                for (name, value, default) in missing {
                    let ty = self.type_from_defaulted_element(file, value, default);
                    shape.props.push(Prop {
                        name,
                        flags: PropFlags::OPTIONAL,
                        source: PropSource::Type(ty),
                        mapper: MapperId::IDENTITY,
                    });
                }
                for info in &members.shape().index {
                    let value = self.instantiate(info.value, members.mapper);
                    shape.index.push(IndexInfo { value, ..*info });
                }
                self.synth(shape)
            }
            PatKind::Array(elems) => {
                let TypeData::Tuple {
                    elems: types,
                    flags,
                    readonly,
                } = self.data(ty).clone()
                else {
                    return ty;
                };
                if flags
                    .iter()
                    .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                    || types.len() >= elems.len()
                {
                    return ty;
                }
                let (mut types, mut flags) = (types.to_vec(), flags.to_vec());
                for (i, e) in elems.iter().enumerate().skip(types.len()) {
                    let elem = &hir[e];
                    if i + 1 == elems.len() && elem.is_rest {
                        break;
                    }
                    types.push(if elem.default.is_some() {
                        self.type_from_defaulted_element(file, elem.pat, elem.default)
                    } else {
                        TypeId::ANY
                    });
                    flags.push(ElemFlags::OPTIONAL);
                }
                self.tuple(&types, &flags, readonly)
            }
            _ => ty,
        }
    }

    /// `getTypeFromBindingElement`, of an element below a parameter that has a default: what the default is, padded in its turn for
    /// `pat`, which the element is bound to. Only its literals are widened, and it may be left out.
    fn type_from_defaulted_element(&mut self, file: FileId, pat: PatId, default: ExprId) -> TypeId {
        // `checkDeclarationInitializer`
        let ty = self.type_of_declaration_initializer(file, default);
        let ty = self.padded_for_pattern(file, pat, ty);
        // `getWidenedLiteralTypeForInitializer`, `addOptionality`
        let ty = self.widen_literal(ty);
        self.optional(ty)
    }

    /// `GetDeclarationOfKind(getSymbolOfDeclaration(accessor), kind)`: the getter, or the setter if that is what is `wanted`, that is
    /// one symbol with the accessor `func`, in a class, an interface, a type literal or an object literal.
    /// `declareSymbolEx`: what declares one name joins the symbol of that name in the order written. What does not go with what
    /// has joined so far is a symbol of its own.
    pub(super) fn sibling_accessor(
        &mut self,
        file: FileId,
        func: FnId,
        wanted: FnKind,
    ) -> Option<FnId> {
        use crate::bind::MemberOwner;
        // What a declaration makes of the name, and what that does not go with (the `*Excludes`).
        const PROPERTY: u8 = 1;
        const METHOD: u8 = 2;
        const GET: u8 = 4;
        const SET: u8 = 8;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // (includes, excludes, function)
        let mut declared: Vec<(u8, u8, FnId)> = Vec::new();
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => {
                let members = match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => hir[c].members,
                    MemberOwner::Interface(i) => hir[i].members,
                    MemberOwner::TypeLiteral(t) => match hir[t].kind {
                        TypeNodeKind::Object(members) => members,
                        _ => return None,
                    },
                    MemberOwner::None => return None,
                };
                let name = self.member_name(file, hir[m].key)?;
                let is_static = hir[m].flags.contains(Flags::STATIC);
                for o in members.iter() {
                    let other = &hir[o];
                    let (includes, excludes) = match other.kind {
                        MemberKind::Property if other.flags.contains(Flags::ACCESSOR) => {
                            (GET | SET, METHOD | GET | SET)
                        }
                        MemberKind::Property => (PROPERTY, METHOD),
                        MemberKind::Method => (METHOD, PROPERTY | GET | SET),
                        MemberKind::Getter => (GET, METHOD | GET),
                        MemberKind::Setter => (SET, METHOD | SET),
                        _ => continue,
                    };
                    if other.flags.contains(Flags::STATIC) == is_static
                        && self.member_name(file, other.key) == Some(name)
                    {
                        declared.push((includes, excludes, other.func));
                    }
                }
            }
            FnOwner::Expr(e) => {
                let Parent::Prop(p) = bound.expr_parent[e.idx()] else {
                    return None;
                };
                let owner = bound.prop_owner[p.idx()];
                if owner.is_none() {
                    return None;
                }
                let ExprKind::Object(props) = hir[owner].kind else {
                    return None;
                };
                let name = self.member_name(file, hir[p].key)?;
                for q in props.iter() {
                    let other = &hir[q];
                    let (includes, excludes) = match other.kind {
                        PropKind::Init | PropKind::Shorthand => (PROPERTY, METHOD),
                        // A method of an object literal goes with nothing.
                        PropKind::Method => (METHOD, PROPERTY | METHOD | GET | SET),
                        PropKind::Getter => (GET, METHOD | GET),
                        PropKind::Setter => (SET, METHOD | SET),
                        PropKind::Spread => continue,
                    };
                    if self.member_name(file, other.key) != Some(name) {
                        continue;
                    }
                    let accessor = match other.kind {
                        PropKind::Getter | PropKind::Setter if other.value.is_some() => {
                            match hir[other.value].kind {
                                ExprKind::Fn(f) => f,
                                _ => FnId::NONE,
                            }
                        }
                        _ => FnId::NONE,
                    };
                    declared.push((includes, excludes, accessor));
                }
            }
            _ => return None,
        }
        let wanted = if wanted == FnKind::Getter { GET } else { SET };
        let (mut flags, mut has_joined, mut found) = (0u8, false, FnId::NONE);
        for (includes, excludes, accessor) in declared {
            if flags & excludes != 0 {
                // An accessor that met anything but its like goes with nothing that follows.
                if flags & (GET | SET) != 0 && flags & (GET | SET) != includes & (GET | SET) {
                    flags |= GET | SET;
                }
                if accessor == func {
                    return None;
                }
                continue;
            }
            flags |= includes;
            has_joined |= accessor == func;
            if includes == wanted && found.is_none() {
                found = accessor;
            }
        }
        if has_joined { found.some() } else { None }
    }

    /// `getAnnotatedAccessorType` of the setter that is one symbol with the getter `getter`: what that says it takes.
    pub(super) fn setter_annotation_next_to(
        &mut self,
        file: FileId,
        getter: FnId,
    ) -> Option<TypeId> {
        self.annotated_setter_type(file, getter)
    }

    // ───────────────────────────── what functions return ─────────────────────────────

    /// The return type of `func` as declared or as its body implies, in terms of the type parameters in scope.
    pub fn return_type_of_fn(&mut self, file: FileId, func: FnId) -> TypeId {
        if let Some(known) = self.p.fn_return_types.get(file, func.idx()) {
            return known;
        }
        if !self.enter(Query::Return(file, func)) {
            return if self.came_full_circle {
                TypeId::ANY
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.return_type_of_fn_uncached(file, func);
        let ty = self.force(ty);
        let holds = self.leave();
        if self.left_a_circle {
            self.p.circular_returns.insert((file, func), ());
            self.p.fn_return_types.set(file, func.idx(), TypeId::ANY);
            return TypeId::ANY;
        }
        // `getReturnTypeOfSignature`: what was settled meanwhile is the answer.
        if let Some(known) = self.p.fn_return_types.get(file, func.idx()) {
            return known;
        }
        if holds {
            self.p.fn_return_types.set(file, func.idx(), ty);
        }
        ty
    }

    /// `getReturnTypeFromAnnotation`, then `getReturnTypeFromBody`. It pushes no resolution and caches nothing.
    pub(super) fn return_type_of_fn_uncached(&mut self, file: FileId, func: FnId) -> TypeId {
        let hir = self.hir(file);
        let f = &hir[func];
        if f.ret.is_some() {
            return self.type_from_node(file, f.ret);
        }
        // `getReturnTypeFromAnnotation`: a getter that says nothing goes by what its setter says it takes.
        if f.kind == FnKind::Getter
            && let Some(ty) = self.setter_annotation_next_to(file, func)
        {
            return ty;
        }
        match f.kind {
            FnKind::Setter | FnKind::StaticBlock => return TypeId::VOID,
            FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType => {
                return TypeId::ANY;
            }
            _ => {}
        }
        // `getReturnTypeOfSignature`: `NodeIsMissing(body)`, a block whose `{` is not there.
        if f.flags.contains(Flags::MISSING_BODY) {
            return TypeId::ANY;
        }
        let is_async = f.flags.contains(Flags::ASYNC);
        let is_generator = f.flags.contains(Flags::GENERATOR);
        let info = self.bound(file).fns[func.idx()];
        let mut ret = match f.body {
            // `getReturnTypeOfSignature`: `any` only where no body was written. One that was written and is not kept could return anything.
            FnBody::None => {
                return if f.flags.contains(Flags::BODY_DROPPED) {
                    TypeId::UNRESOLVED
                } else {
                    TypeId::ANY
                };
            }
            FnBody::Expr(e) => {
                let ty = self.type_of_expr(file, e);
                let ty = self.regular_in_const_context(file, e, ty);
                if is_async { self.awaited(ty) } else { ty }
            }
            // `checkAndAggregateReturnExpressionTypes`
            FnBody::Block(_) => {
                let mut types: Vec<TypeId> = Vec::new();
                let mut without_expression =
                    info.end != UNREACHABLE && self.is_reachable(file, info.end);
                let mut returns_never = false;
                for stmt in self.bound(file).ids(info.returns) {
                    let StmtKind::Return(e) = hir[stmt].kind else {
                        continue;
                    };
                    if e.is_none() {
                        without_expression = true;
                        continue;
                    }
                    if self.is_call_of_the_function_itself(file, func, e, is_async) {
                        returns_never = true;
                        continue;
                    }
                    let mut ty = self.type_of_expr(file, e);
                    if is_async {
                        ty = self.awaited(ty);
                    }
                    if ty == TypeId::NEVER {
                        returns_never = true;
                    }
                    ty = self.regular_in_const_context(file, e, ty);
                    if !types.contains(&ty) {
                        types.push(ty);
                    }
                }
                let may_return_never = matches!(f.kind, FnKind::Expr | FnKind::Arrow)
                    || (f.kind == FnKind::Method && matches!(info.owner, FnOwner::Expr(_)));
                if types.is_empty() && !without_expression && (returns_never || may_return_never) {
                    TypeId::NEVER
                } else if types.is_empty() {
                    // `undefinedType` if `undefined` is among what is expected. A generator that returns nothing returns `void`, whatever is expected.
                    let expected = if is_generator {
                        None
                    } else {
                        self.contextual_return_type(file, func)
                    };
                    let expected = expected.map(|t| if is_async { self.awaited(t) } else { t });
                    if expected.is_some_and(|t| self.some_type(t, |_, m| m.is_undefined())) {
                        self.undefined_as_declared()
                    } else {
                        TypeId::VOID
                    }
                } else {
                    if without_expression {
                        types.push(TypeId::UNDEFINED);
                    }
                    self.union_reduced(&types)
                }
            }
        };
        if !is_generator {
            // `getWidenedLiteralLikeTypeForContextualReturnTypeIfNeeded`
            if self.is_unit(ret) {
                let mut contextual = self.return_type_of_contextual_signature(file, func);
                if is_async {
                    // `GetPromisedTypeOfPromise`
                    contextual = contextual.and_then(|t| self.thenable_value(t));
                }
                ret = self.widen_literal_for_context(ret, contextual);
            }
            ret = self.regular_object(ret);
            if is_async {
                // `unwrapAwaitedType`: a promise of `Awaited<T>` is a promise of `T`.
                let ret = self.map_type(ret, |c, m| c.awaited_argument(m).unwrap_or(m));
                return self.promise_of(ret);
            }
            return ret;
        }
        // `checkAndAggregateYieldOperandTypes`
        let (mut yields, mut nexts) = (Vec::new(), Vec::new());
        for e in self.bound(file).ids(info.yields) {
            let ExprKind::Yield { value, star } = hir[e].kind else {
                continue;
            };
            if self.is_yield_in_parameter(file, e) {
                continue;
            }
            let operand = if value.is_none() {
                TypeId::UNDEFINED
            } else {
                let ty = self.type_of_expr(file, value);
                self.regular_in_const_context(file, value, ty)
            };
            // `getYieldedTypeOfYieldExpression`: an async generator awaits what it yields, `yield*` or not.
            let mut ty = if star {
                self.iterated_type(operand, is_async)
            } else {
                operand
            };
            if is_async {
                ty = self.awaited(ty);
            }
            if !yields.contains(&ty) {
                yields.push(ty);
            }
            // What `next` is to be given: whatever the results of the `yield`s are expected to be.
            let next = if star {
                self.iterable_types(operand, true, is_async, false, None).n
            } else {
                self.contextual_type(file, e)
            };
            if let Some(next) = next
                && !nexts.contains(&next)
            {
                nexts.push(next);
            }
        }
        let mut yielded = self.union_reduced(&yields);
        let mut next = if nexts.is_empty() {
            None
        } else {
            Some(self.intersection(&nexts))
        };
        // `getWidenedLiteralLikeTypeForContextualIterationTypeIfNeeded`: only a type with one value is widened, and only where no
        // literal is expected. A union of literals stays.
        if self.is_unit(ret) || self.is_unit(yielded) || next.is_some_and(|t| self.is_unit(t)) {
            // `getIterationTypeOfGeneratorFunctionReturnType`: `any` says nothing.
            let expected = self
                .return_type_of_contextual_signature(file, func)
                .filter(|&t| t != TypeId::ANY);
            let expected = expected.and_then(|t| self.iteration_types(t, is_async));
            if self.is_unit(yielded) {
                yielded = self.widen_literal_for_context(yielded, expected.map(|t| t.yielded));
            }
            if self.is_unit(ret) {
                ret = self.widen_literal_for_context(ret, expected.map(|t| t.returned));
            }
            if let Some(ty) = next
                && self.is_unit(ty)
            {
                next = Some(self.widen_literal_for_context(ty, expected.map(|t| t.next)));
            }
        }
        // `getWidenedType`
        let yielded = self.regular_object(yielded);
        let ret = self.regular_object(ret);
        let next = match next {
            Some(next) => self.regular_object(next),
            // `getContextualIterationType`, to which `any` says nothing either.
            None => {
                let expected = self
                    .declared_or_contextual_return_type(file, func)
                    .filter(|&t| t != TypeId::ANY);
                expected
                    .and_then(|t| self.iteration_types(t, is_async))
                    .map_or(TypeId::UNKNOWN, |t| t.next)
            }
        };
        // `createGeneratorType`
        let names = if is_async {
            [known::AsyncGenerator, known::AsyncIterableIterator]
        } else {
            [known::Generator, known::IterableIterator]
        };
        for name in names {
            // `getGlobalType`: a class or an interface with as many type parameters, or it does not count.
            if let Some(sym) = self.global_type_symbol(name)
                && self
                    .files()
                    .flags(sym)
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                && self.type_params_of_symbol(sym).len() == 3
            {
                return self.global_ref(name, &[yielded, ret, next]);
            }
        }
        TypeId::EMPTY_OBJECT
    }

    /// `forEachYieldExpression` goes through the body alone: whether the `yield` `e` is in a parameter of its function instead.
    fn is_yield_in_parameter(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = bound.expr_parent[e.idx()];
        loop {
            at = match at {
                Parent::ParamDefault(_) => return true,
                // What a static block yields is for the function around.
                Parent::FnBody(f) if hir[f].kind != FnKind::StaticBlock => return false,
                Parent::None | Parent::File | Parent::Module(_) => return false,
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Key(literal) if literal.is_some() => Parent::Expr(literal),
                _ => self.outward(file, at),
            };
        }
    }

    /// The type `ty` of `e`, which is returned or yielded: `getRegularTypeOfLiteralType` of it if `isConstContext(e)`.
    fn regular_in_const_context(&mut self, file: FileId, e: ExprId, ty: TypeId) -> TypeId {
        if !self.some_type(ty, |c, m| c.is_fresh_literal(m)) {
            return ty;
        }
        let hir = self.hir(file);
        // `isValidConstAssertionArgument`, of what has a literal type.
        let is_valid = match hir[e].kind {
            ExprKind::String(_)
            | ExprKind::Template { .. }
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False => true,
            ExprKind::Unary { op, operand } => {
                matches!(
                    (op, hir[operand].kind),
                    (UnOp::Minus, ExprKind::Number(_) | ExprKind::BigInt(_))
                        | (UnOp::Plus, ExprKind::Number(_))
                )
            }
            // A member of an enum.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                if matches!(hir[obj].kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) =>
            {
                let object = self.type_of_expr(file, obj);
                matches!(
                    self.data(object),
                    TypeData::Anon {
                        origin: Origin::EnumObject(_),
                        ..
                    }
                )
            }
            _ => false,
        };
        if is_valid && self.in_const_context(file, e) {
            self.regular(ty)
        } else {
            ty
        }
    }

    /// What the signature `func` is expected to have returns, which is what says whether a literal it returns stays one
    /// (`getReturnTypeFromBody`). A function that is called where it is written is expected to have none.
    fn return_type_of_contextual_signature(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let sig = self.contextual_signature(file, func)?;
        // `getReturnTypeOfSignature` of a composite signature asks every member, and here nothing holds it back while the return type
        // of one of them is being resolved: that is a circle.
        if let SigData::Synth {
            ret: TypeId::UNRESOLVED,
            of,
            ..
        } = self.p.types.sig(sig)
            && !of.is_empty()
        {
            let of = of.to_vec();
            let returns: Vec<TypeId> = of.iter().map(|&s| self.sig_return(s)).collect();
            // `createUnionSignature` clones the first member, so the circle of the composite signature is reported where that one is
            // declared.
            if let Some((first_file, first, _)) = self.sig_decl(of[0]) {
                self.p.circular_returns.insert((first_file, first), ());
            }
            return Some(self.union_reduced(&returns));
        }
        if self.is_resolving_return_type(sig) {
            return None;
        }
        Some(self.sig_return(sig))
    }

    /// `return f(..)` in `f`, or `return await f(..)`: it gives what the other returns give.
    fn is_call_of_the_function_itself(
        &mut self,
        file: FileId,
        func: FnId,
        mut e: ExprId,
        is_async: bool,
    ) -> bool {
        let hir = self.hir(file);
        if is_async && let ExprKind::Await(operand) = hir[e].kind {
            e = operand;
        }
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let callee = hir[call].callee;
        if !matches!(hir[callee].kind, ExprKind::Ident(_)) {
            return false;
        }
        let symbol = self.bound(file).expr_symbol[callee.idx()];
        if symbol.is_none() {
            return false;
        }
        match hir[func].kind {
            FnKind::Decl => self.bound(file).symbols[symbol.idx()]
                .decls
                .contains(&Decl::Fn(func)),
            FnKind::Expr | FnKind::Arrow => {
                if !self.is_constant_name(file, symbol) {
                    return false;
                }
                // The name it gives itself.
                if self.bound(file).symbols[symbol.idx()]
                    .decls
                    .contains(&Decl::Fn(func))
                {
                    return true;
                }
                let ty = self.type_of_expr(file, callee);
                matches!(self.data(ty), TypeData::Fns { decls, .. } if decls.len() == 1 && decls[0] == (file, func))
            }
            _ => false,
        }
    }

    /// `getWidenedLiteralLikeTypeForContextualType`: a literal stays one where a literal is expected.
    pub fn widen_literal_for_context(&mut self, ty: TypeId, contextual: Option<TypeId>) -> TypeId {
        match contextual {
            // Meant as itself, from here on: it is not widened later.
            Some(contextual) if self.is_literal_context(ty, contextual) => self.regular(ty),
            _ => {
                let ty = self.widen_literal(ty);
                // `getWidenedUniqueESSymbolType`
                if !self.some_type(ty, |c, m| {
                    matches!(c.data(m), TypeData::UniqueSymbol { .. })
                }) {
                    return ty;
                }
                self.map_type(ty, |c, m| {
                    if matches!(c.data(m), TypeData::UniqueSymbol { .. }) {
                        TypeId::SYMBOL
                    } else {
                        m
                    }
                })
            }
        }
    }

    /// `isLiteralOfContextualType`: whether `contextual` has room for the literal type `candidate`, as opposed to its base type only.
    pub fn is_literal_context(&mut self, candidate: TypeId, contextual: TypeId) -> bool {
        self.guard("is_literal_context");
        // `TypeFlagsStringLiteral`, `TypeFlagsNumberLiteral`: a member of an enum has that of its value, one that is worked out neither.
        let is_string_literal = |c: &Self, m: TypeId| {
            matches!(
                c.data(m),
                TypeData::StringLit { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::String(_),
                        ..
                    }
            )
        };
        let is_number_literal = |c: &Self, m: TypeId| {
            matches!(
                c.data(m),
                TypeData::NumberLit { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::Number(_),
                        ..
                    }
            )
        };
        let is_bigint_literal =
            |c: &Self, m: TypeId| matches!(c.data(m), TypeData::BigIntLit { .. });
        let is_unique_symbol =
            |c: &Self, m: TypeId| matches!(c.data(m), TypeData::UniqueSymbol { .. });
        let contextual = self.force(contextual);
        if let TypeData::Union(parts) | TypeData::Intersection(parts) = self.data(contextual) {
            return parts.iter().any(|&p| self.is_literal_context(candidate, p));
        }
        // `TypeFlagsInstantiableNonPrimitive`, which `keyof T` is not.
        if self.is_deferred(contextual) && !matches!(self.data(contextual), TypeData::Keyof(_)) {
            // A type parameter that extends a primitive wants the literal, be it `string & {}` that it extends.
            let constraint = self.base_constraint(contextual);
            let extends =
                |c: &Self, kind: fn(&Self, TypeId) -> bool| c.maybe_type_of_kind(constraint, kind);
            return (extends(self, |_: &Self, m: TypeId| m == TypeId::STRING)
                && self.maybe_type_of_kind(candidate, is_string_literal))
                || (extends(self, |_: &Self, m: TypeId| m == TypeId::NUMBER)
                    && self.maybe_type_of_kind(candidate, is_number_literal))
                || (extends(self, |_: &Self, m: TypeId| m == TypeId::BIGINT)
                    && self.maybe_type_of_kind(candidate, is_bigint_literal))
                || (extends(self, |_: &Self, m: TypeId| m == TypeId::SYMBOL)
                    && self.maybe_type_of_kind(candidate, is_unique_symbol))
                || (!self.is_deferred(constraint)
                    && self.is_literal_context(candidate, constraint));
        }
        match self.data(contextual) {
            TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
            | TypeData::Keyof(_)
            | TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => self.maybe_type_of_kind(candidate, is_string_literal),
            TypeData::NumberLit { .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(_),
                ..
            } => self.maybe_type_of_kind(candidate, is_number_literal),
            TypeData::BigIntLit { .. } => self.maybe_type_of_kind(candidate, is_bigint_literal),
            TypeData::BoolLit { .. } => self.maybe_type_of_kind(candidate, Self::is_boolean_like),
            TypeData::UniqueSymbol { .. } => self.maybe_type_of_kind(candidate, is_unique_symbol),
            _ => false,
        }
    }

    // ───────────────────────────── promises and iterables ─────────────────────────────

    /// `X`, if `ty` is `Awaited<X>` waiting for `X` to be known.
    pub(super) fn awaited_argument(&mut self, ty: TypeId) -> Option<TypeId> {
        let TypeData::Cond { file, node, mapper } = *self.data(ty) else {
            return None;
        };
        let alias = self.files().global(known::Awaited, SymFlags::TYPE_ALIAS)?;
        if alias.file != file {
            return None;
        }
        let &Decl::Alias(a) = self.files().symbol(alias).decls.first()? else {
            return None;
        };
        let hir = self.hir(file);
        if hir[a].ty != node {
            return None;
        }
        let param = self.type_param(file, hir[a].type_params.iter().next()?);
        Some(self.instantiate(param, mapper))
    }

    /// `checkAwaitedType`: what `await` gives for a value of type `ty`. Where that is an error it can be anything.
    pub fn awaited(&mut self, ty: TypeId) -> TypeId {
        self.awaited_or_none(ty).unwrap_or(TypeId::ANY)
    }

    /// `getAwaitedType`. `None`: to await a `ty` is an error.
    pub(super) fn awaited_or_none(&mut self, ty: TypeId) -> Option<TypeId> {
        let awaited = self.awaited_no_alias(ty)?;
        // `createAwaitedTypeIfNeeded`, of the whole: `T | U` is `Awaited<T | U>` if either may turn out to be a promise.
        if self.is_awaited_type_needed(awaited)
            && let Some(alias) = self.files().global(known::Awaited, SymFlags::TYPE_ALIAS)
        {
            // `unwrapAwaitedType`: `Awaited<T | U>` does for `Awaited<Awaited<T> | U>`.
            let unwrapped = self.map_type(awaited, |c, m| c.awaited_argument(m).unwrap_or(m));
            return Some(self.type_reference(alias, &[unwrapped]));
        }
        Some(awaited)
    }

    /// `getAwaitedTypeNoAlias`: the same, but what may turn out to be a promise stands for itself, not wrapped in `Awaited`.
    pub(super) fn awaited_no_alias(&mut self, ty: TypeId) -> Option<TypeId> {
        self.guard("awaited");
        let ty = self.force(ty);
        if self.is_any(ty) || self.is_primitive(ty) || self.awaited_argument(ty).is_some() {
            return Some(ty);
        }
        if self.is_union(ty) {
            // `type S = string | Promise<S>` never comes to an end.
            if self.awaiting.contains(&ty) {
                return None;
            }
            self.awaiting.push(ty);
            let parts = self.parts(ty);
            let mut mapped = Vec::with_capacity(parts.len());
            for &part in parts {
                mapped.extend(self.awaited_no_alias(part));
            }
            self.awaiting.pop();
            // `mapType`: a member for which there is nothing is left out, and nothing left is nothing.
            if mapped[..] == parts[..] {
                return Some(ty);
            }
            return if mapped.is_empty() {
                None
            } else {
                Some(self.union(&mapped))
            };
        }
        if self.is_awaited_type_needed(ty) {
            return Some(ty);
        }
        if let Some(promised) = self.thenable_value(ty) {
            let promised = self.force(promised);
            // A promise of itself, or of a promise of itself, is never settled.
            if promised == ty || self.awaiting.contains(&promised) {
                return None;
            }
            if self.depth > 40 {
                return Some(TypeId::UNRESOLVED);
            }
            self.depth += 1;
            self.awaiting.push(ty);
            let awaited = self.awaited_no_alias(promised);
            self.awaiting.pop();
            self.depth -= 1;
            return awaited;
        }
        // What has a `then` to call and is no promise would never be settled either.
        if self.is_thenable(ty) { None } else { Some(ty) }
    }

    /// `isAwaitedTypeNeeded`: whether `ty` waits for a type parameter that may turn out to be a promise.
    fn is_awaited_type_needed(&mut self, ty: TypeId) -> bool {
        if self.is_any(ty)
            || self.awaited_argument(ty).is_some()
            || !self.is_generic_object_type(ty)
        {
            return false;
        }
        match self.base_constraint_of(ty) {
            Some(constraint) => {
                self.is_any(constraint)
                    || constraint == TypeId::UNKNOWN
                    || self.is_empty_object_type(constraint)
                    || self.parts(constraint).iter().any(|&m| self.is_thenable(m))
            }
            None => self.maybe_type_of_kind(ty, Self::is_type_variable),
        }
    }

    /// `allTypesAssignableToKind(getBaseConstraintOrType(ty), TypeFlagsPrimitive | TypeFlagsNever)`
    fn is_all_primitive_or_never(&mut self, ty: TypeId) -> bool {
        let base = self.base_constraint_of(ty).unwrap_or(ty);
        base == TypeId::NEVER
            || self.every_type(base, |c, m| match c.data(m) {
                // `string & { tag: 1 }` is a string.
                TypeData::Intersection(parts) => parts.iter().any(|&p| c.is_primitive(p)),
                _ => c.is_primitive(m),
            })
    }

    /// `getPropertyOfType`, and `getTypeOfSymbol` of that: the type of the property `name` of `ty`, and whether it may be left out.
    /// No index signature stands in for a property. For names that neither `Object` nor `Function` has.
    fn declared_property(&mut self, ty: TypeId, name: Atom) -> Option<(TypeId, bool)> {
        // `getReducedApparentType`
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        // `createUnionOrIntersectionProperty`: some member has to declare it. It may be left out if it may in any of them.
        if self.is_union(apparent) {
            let (mut is_declared, mut is_optional) = (false, false);
            for &part in self.parts(apparent) {
                let part = self.apparent_type(part);
                if let Some((prop, _)) = self.prop_of(part, name) {
                    is_declared = true;
                    is_optional |= prop.flags.contains(PropFlags::OPTIONAL);
                }
            }
            if !is_declared {
                return None;
            }
            return self
                .type_of_property(apparent, name)
                .map(|found| (found, is_optional));
        }
        let (prop, mapper) = self.prop_of(apparent, name)?;
        let found = self.type_of_prop(&prop, mapper);
        let is_optional = prop.flags.contains(PropFlags::OPTIONAL);
        Some((
            if is_optional {
                self.optional_property(found)
            } else {
                found
            },
            is_optional,
        ))
    }

    /// `getTypeOfFirstParameterOfSignature`
    pub(super) fn type_of_first_parameter(&mut self, sig: SigId) -> TypeId {
        let params = self.sig_params(sig);
        if params.is_empty() {
            TypeId::NEVER
        } else {
            self.param_type_at(&params, 0).unwrap_or(TypeId::ANY)
        }
    }

    /// `isThenableType`: whether a `ty` has a `then` that can be called.
    pub(super) fn is_thenable(&mut self, ty: TypeId) -> bool {
        if self.is_all_primitive_or_never(ty) {
            return false;
        }
        let Some((then, _)) = self.declared_property(ty, known::then) else {
            return false;
        };
        // `TypeFactsNEUndefinedOrNull`
        let then = self.filter(then, |c, m| !c.is_nullish(m));
        !self.signatures(then, false).is_empty()
    }

    /// `getPromisedTypeOfPromise`: what the callback given to `ty.then` is called with. `None`: a `ty` is no promise.
    pub(super) fn thenable_value(&mut self, ty: TypeId) -> Option<TypeId> {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return None;
        }
        // The `then` of a `PromiseLike` comes to the same.
        if let Some(args) = self
            .is_global_ref(ty, known::Promise)
            .or_else(|| self.is_global_ref(ty, known::PromiseLike))
        {
            return args.first().copied();
        }
        // What is no object is not taken for a promise, whatever `then` it has.
        if self.is_all_primitive_or_never(ty) {
            return None;
        }
        let (then, _) = self.declared_property(ty, known::then)?;
        // Not found out, and so neither is what is promised.
        if then == TypeId::UNRESOLVED {
            return Some(then);
        }
        if self.is_any(then) {
            return None;
        }
        // The ways to call `then` on a `ty`.
        let mut callbacks = Vec::new();
        for sig in self.signatures(then, false) {
            if let Some(this) = self.sig_this_type(sig)
                && this != TypeId::VOID
                && !self.is_subtype(ty, this)
            {
                continue;
            }
            callbacks.push(self.type_of_first_parameter(sig));
        }
        if callbacks.is_empty() {
            return None;
        }
        let on_fulfilled = self.union(&callbacks);
        // `TypeFactsNEUndefinedOrNull`
        let on_fulfilled = self.filter(on_fulfilled, |c, m| !c.is_nullish(m));
        if on_fulfilled == TypeId::UNRESOLVED {
            return Some(on_fulfilled);
        }
        if self.is_any(on_fulfilled) {
            return None;
        }
        let mut values = Vec::new();
        for callback in self.signatures(on_fulfilled, false) {
            values.push(self.type_of_first_parameter(callback));
        }
        if values.is_empty() {
            return None;
        }
        Some(self.union_reduced(&values))
    }

    /// `checkIteratedTypeOrElementType`: what `for (const x of ty)` binds `x` to, `for await` if `is_async`, and what `...ty` and
    /// `yield* ty` give one at a time. What cannot be gone through, `never` for one, is an error, and what is in error can be anything.
    pub fn iterated_type(&mut self, ty: TypeId, is_async: bool) -> TypeId {
        self.guard("iterated_type");
        match self.iterated_type_if_any(ty, is_async) {
            Some(element) => element,
            None if self.is_known(ty) => TypeId::ANY,
            None => TypeId::UNRESOLVED,
        }
    }

    /// `iterated_type`
    pub(super) fn checked_iterated_type(&mut self, ty: TypeId, is_async: bool) -> TypeId {
        self.iterated_type(ty, is_async)
    }

    /// `getIteratedTypeOrElementType`. `None`: a `ty` cannot be gone through.
    pub(super) fn iterated_type_if_any(&mut self, ty: TypeId, is_async: bool) -> Option<TypeId> {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return Some(ty);
        }
        if ty == TypeId::NEVER {
            return None;
        }
        let iterable_exists = self.global_type_of_arity(known::Iterable, 3).is_some();
        if iterable_exists || is_async {
            let yielded = self.iterable_types(ty, true, is_async, true, None).y;
            if yielded.is_some() || iterable_exists {
                return yielded;
            }
        }
        // Without `Iterable` there are strings, and what is like an array. Strings are for `for..of` alone
        // (`IterationUseAllowsStringInputFlag`), but who asks is not told apart here.
        let arrays = self.filter(ty, |c, m| !c.is_string_like(m));
        if arrays == TypeId::NEVER {
            return Some(TypeId::STRING);
        }
        let has_string = arrays != ty;
        if !self.is_array_like(arrays) {
            return has_string.then_some(TypeId::STRING);
        }
        let element = self.number_index_type(arrays)?;
        Some(if has_string {
            self.union_reduced(&[element, TypeId::STRING])
        } else {
            element
        })
    }

    /// `getIndexTypeOfType(ty, numberType)`
    fn number_index_type(&mut self, ty: TypeId) -> Option<TypeId> {
        let mut elements = Vec::new();
        for &part in self.parts(ty) {
            let apparent = self.apparent_type(part);
            let members = self.members(apparent)?;
            let info = members
                .shape()
                .index
                .iter()
                .find(|info| info.key == TypeId::NUMBER)?;
            elements.push(self.instantiate(info.value, members.mapper));
        }
        if elements.is_empty() {
            None
        } else {
            Some(self.union(&elements))
        }
    }

    /// `checkYieldExpression`: what `yield value` evaluates to, which is what the caller passes to `next`. For `yield*`, what the
    /// other iterator returns.
    pub(super) fn type_of_yield(
        &mut self,
        file: FileId,
        e: ExprId,
        value: ExprId,
        star: bool,
    ) -> TypeId {
        let Some(func) = self.enclosing_fn_of_expr(file, e) else {
            return TypeId::ANY;
        };
        let f = &self.hir(file)[func];
        if !f.flags.contains(Flags::GENERATOR) {
            return TypeId::ANY;
        }
        let is_async = f.flags.contains(Flags::ASYNC);
        if star {
            let ty = self.type_of_expr(file, value);
            return self
                .iterable_types(ty, true, is_async, false, None)
                .r
                .unwrap_or(TypeId::ANY);
        }
        let Some(declared) = self.declared_or_contextual_return_type(file, func) else {
            return TypeId::ANY;
        };
        let mut declared = self.force(declared);
        // Of the alternatives it says it returns, those that a generator is.
        if f.ret.is_some() && self.is_union(declared) {
            declared = self.filter(declared, |c, t| c.is_what_a_generator_is(t, is_async));
        }
        self.generator_return_types(declared, is_async)
            .n
            .unwrap_or(TypeId::ANY)
    }

    /// `checkGeneratorInstantiationAssignabilityToReturnType`: whether the generator that yields, returns and is sent what a `ty`
    /// does is a `ty`.
    fn is_what_a_generator_is(&mut self, ty: TypeId, is_async: bool) -> bool {
        // `getIterationTypeOfGeneratorFunctionReturnType`: `any` says nothing.
        let types = if self.is_any(ty) {
            Iter3::default()
        } else {
            self.generator_return_types(ty, is_async)
        };
        let yielded = types.y.unwrap_or(TypeId::ANY);
        let generator = self.generator_of(
            yielded,
            types.r.unwrap_or(yielded),
            types.n.unwrap_or(TypeId::UNKNOWN),
            is_async,
        );
        self.is_assignable(generator, ty)
    }

    /// `getIterationTypesOfGeneratorFunctionReturnType`: what a generator function that says it returns a `ty` is to yield, to return
    /// in the end, and is sent. `None`: a `ty` is neither something to go through nor an iterator. Where there are some but
    /// not all three, whoever asks makes do with anything, and with `unknown` for what it is sent.
    pub fn iteration_types(&mut self, ty: TypeId, is_async: bool) -> Option<IterationTypes> {
        let types = self.generator_return_types(ty, is_async);
        types.has_types().then(|| IterationTypes {
            yielded: types.y.unwrap_or(TypeId::ANY),
            returned: types.r.unwrap_or(TypeId::ANY),
            next: types.n.unwrap_or(TypeId::UNKNOWN),
        })
    }

    /// The same, with what is missing left missing.
    fn generator_return_types(&mut self, ty: TypeId, is_async: bool) -> Iter3 {
        self.guard("iteration_types");
        let types = self.iterable_types(ty, !is_async, is_async, false, None);
        if types.has_types() {
            types
        } else {
            self.iterator_types(ty, is_async, None)
        }
    }

    /// `getIterationTypesOfIterable`: what comes of going through a `ty`, by its `[Symbol.asyncIterator]` if `asynchronous`, failing
    /// that by its `[Symbol.iterator]` if `sync`. `for_of`: with `for..of`, awaited or not (`IterationUseForOfFlag`).
    /// `said`: the codes of what is found wrong on the way (`diagnosticOutput`). They are errors only if there are types in the end.
    pub(super) fn iterable_types(
        &mut self,
        ty: TypeId,
        sync: bool,
        asynchronous: bool,
        for_of: bool,
        mut said: Option<&mut Vec<u32>>,
    ) -> Iter3 {
        self.guard("iterable_types");
        let ty = self.force(ty);
        let ty = self.reduced(ty);
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        // Each member has to be something to go through. Of the members nothing is said.
        if self.is_union(ty) {
            let parts = self.parts(ty);
            let mut all = Vec::with_capacity(parts.len());
            for &part in parts {
                let types = self.iterable_types(part, sync, asynchronous, for_of, None);
                if !types.has_types() {
                    return Iter3::default();
                }
                all.push(types);
            }
            return self.combine_iteration_types(&all);
        }
        // A type parameter has what it extends has.
        if self.is_deferred(ty) {
            let apparent = self.apparent_type(ty);
            return if apparent == ty {
                Iter3::default()
            } else {
                self.iterable_types(apparent, sync, asynchronous, for_of, said)
            };
        }
        // What the library that has `Iterable` says of arrays, tuples and strings comes to this.
        if sync && self.global_type_of_arity(known::Iterable, 3).is_some() {
            let element = match self.data(ty) {
                TypeData::Tuple { elems, flags, .. } => {
                    Some(self.tuple_element_union(elems, flags))
                }
                _ if self.is_string_like(ty) => Some(TypeId::STRING),
                _ => self.array_element(ty),
            };
            if let Some(element) = element {
                let types = Iter3 {
                    y: Some(element),
                    r: Some(self.builtin_iterator_return()),
                    n: Some(TypeId::UNKNOWN),
                };
                return if asynchronous {
                    self.async_from_sync(types)
                } else {
                    types
                };
            }
        }
        if asynchronous {
            let names = [
                known::AsyncIterable,
                known::AsyncIteratorObject,
                known::AsyncIterableIterator,
                known::AsyncGenerator,
            ];
            let types = self.iteration_types_of_global_reference(ty, names, true);
            if types.has_types() {
                return if for_of {
                    self.async_from_sync(types)
                } else {
                    types
                };
            }
            let types = self.iterable_types_slow(ty, true, said.as_deref_mut());
            if types.has_types() {
                return types;
            }
        }
        if sync {
            let names = [
                known::Iterable,
                known::IteratorObject,
                known::IterableIterator,
                known::Generator,
            ];
            let mut types = self.iteration_types_of_global_reference(ty, names, false);
            if !types.has_types() {
                types = self.iterable_types_slow(ty, false, said.as_deref_mut());
            }
            if types.has_types() {
                return if asynchronous {
                    self.async_from_sync(types)
                } else {
                    types
                };
            }
        }
        Iter3::default()
    }

    /// `getBuiltinIteratorReturnType`
    fn builtin_iterator_return(&self) -> TypeId {
        if self.p.files.options.strict_builtin_iterator_return {
            self.undefined_as_declared()
        } else {
            TypeId::ANY
        }
    }

    /// `getIterationTypesOfIterableFast`, `getIterationTypesOfIteratorFast`: of an instantiation of one of the global types `names`, or
    /// of one of the iterators the library has for its own collections, the type arguments say.
    fn iteration_types_of_global_reference(
        &mut self,
        ty: TypeId,
        names: [Atom; 4],
        is_async: bool,
    ) -> Iter3 {
        for name in names {
            if let Some(&[y, r, n]) = self.is_global_ref(ty, name) {
                return self.resolved_iteration_types(y, r, n, is_async);
            }
        }
        const BUILTIN: [&[u8]; 4] = [
            b"ArrayIterator",
            b"MapIterator",
            b"SetIterator",
            b"StringIterator",
        ];
        const BUILTIN_ASYNC: [&[u8]; 1] = [b"ReadableStreamAsyncIterator"];
        let builtin: &[&[u8]] = if is_async { &BUILTIN_ASYNC } else { &BUILTIN };
        for &name in builtin {
            if let Some(name) = self.files().atoms.lookup(name)
                && let Some(&[y]) = self.is_global_ref(ty, name)
            {
                let r = self.builtin_iterator_return();
                return self.resolved_iteration_types(y, r, TypeId::UNKNOWN, is_async);
            }
        }
        Iter3::default()
    }

    /// `getResolvedIterationTypes`: an asynchronous iterator awaits what it yields and what it returns. What cannot be awaited stays.
    fn resolved_iteration_types(
        &mut self,
        y: TypeId,
        r: TypeId,
        n: TypeId,
        is_async: bool,
    ) -> Iter3 {
        if !is_async {
            return Iter3 {
                y: Some(y),
                r: Some(r),
                n: Some(n),
            };
        }
        let y = self.awaited_or_none(y).unwrap_or(y);
        let r = self.awaited_or_none(r).unwrap_or(r);
        Iter3 {
            y: Some(y),
            r: Some(r),
            n: Some(n),
        }
    }

    /// `combineIterationTypes`: of each kind the union of those there are.
    fn combine_iteration_types(&mut self, all: &[Iter3]) -> Iter3 {
        let (mut y, mut r, mut n) = (Vec::new(), Vec::new(), Vec::new());
        for types in all {
            y.extend(types.y);
            r.extend(types.r);
            n.extend(types.n);
        }
        let mut union_of = |types: Vec<TypeId>| {
            if types.is_empty() {
                None
            } else {
                Some(self.union(&types))
            }
        };
        Iter3 {
            y: union_of(y),
            r: union_of(r),
            n: union_of(n),
        }
    }

    /// `getAsyncFromSyncIterationTypes`
    fn async_from_sync(&mut self, types: Iter3) -> Iter3 {
        let any = Some(TypeId::ANY);
        if !types.has_types() || (types.y == any && types.r == any && types.n == any) {
            return types;
        }
        let y = types.y.map_or(TypeId::ANY, |y| self.awaited(y));
        let r = types.r.map_or(TypeId::ANY, |r| self.awaited(r));
        Iter3 {
            y: Some(y),
            r: Some(r),
            n: types.n,
        }
    }

    /// `getIterationTypesOfIterableSlow`
    fn iterable_types_slow(
        &mut self,
        ty: TypeId,
        is_async: bool,
        said: Option<&mut Vec<u32>>,
    ) -> Iter3 {
        let name = if is_async {
            known::sym_async_iterator
        } else {
            known::sym_iterator
        };
        let Some((method, false)) = self.declared_property(ty, name) else {
            return Iter3::default();
        };
        if self.is_any(method) {
            return Iter3::all(method);
        }
        // What the ways to call it without an argument give, all at once.
        let mut iterators = Vec::new();
        for sig in self.signatures(method, false) {
            let params = self.sig_params(sig);
            if self.min_argument_count(&params) == 0 {
                iterators.push(self.sig_return(sig));
            }
        }
        if iterators.is_empty() {
            return Iter3::default();
        }
        let iterator = self.intersection(&iterators);
        self.iterator_types(iterator, is_async, said)
    }

    /// `getIterationTypesOfIterator`. `said`: as for `iterable_types`.
    pub(super) fn iterator_types(
        &mut self,
        ty: TypeId,
        is_async: bool,
        mut said: Option<&mut Vec<u32>>,
    ) -> Iter3 {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        let names = if is_async {
            [
                known::AsyncIterator,
                known::AsyncIteratorObject,
                known::AsyncIterableIterator,
                known::AsyncGenerator,
            ]
        } else {
            [
                known::Iterator,
                known::IteratorObject,
                known::IterableIterator,
                known::Generator,
            ]
        };
        let types = self.iteration_types_of_global_reference(ty, names, is_async);
        if types.has_types() {
            return types;
        }
        // `getIterationTypesOfIteratorSlow`
        let all = [
            self.iteration_types_of_method(ty, is_async, IteratorMethod::Next, said.as_deref_mut()),
            self.iteration_types_of_method(
                ty,
                is_async,
                IteratorMethod::Return,
                said.as_deref_mut(),
            ),
            self.iteration_types_of_method(
                ty,
                is_async,
                IteratorMethod::Throw,
                said.as_deref_mut(),
            ),
        ];
        self.combine_iteration_types(&all)
    }

    /// `getIterationTypesOfMethod`: what `next`, `return` or `throw` of the iterator `ty` says.
    fn iteration_types_of_method(
        &mut self,
        ty: TypeId,
        is_async: bool,
        which: IteratorMethod,
        said: Option<&mut Vec<u32>>,
    ) -> Iter3 {
        let is_next = which == IteratorMethod::Next;
        let name = match which {
            IteratorMethod::Next => known::next,
            IteratorMethod::Return => self.files().atoms.intern(b"return"),
            IteratorMethod::Throw => self.files().atoms.intern(b"throw"),
        };
        let found = self.declared_property(ty, name);
        // `return` and `throw` may be missing.
        if found.is_none() && !is_next {
            return Iter3::default();
        }
        let mut method = TypeId::NEVER;
        if let Some((declared, is_optional)) = found
            && !(is_next && is_optional)
        {
            // `TypeFactsNEUndefinedOrNull`
            method = if is_next {
                declared
            } else {
                self.filter(declared, |c, m| !c.is_nullish(m))
            };
            if self.is_any(method) {
                return Iter3::all(method);
            }
        }
        let signatures = self.signatures(method, false);
        if signatures.is_empty() {
            if let Some(said) = said {
                said.push(match (is_next, is_async) {
                    (true, false) => 2489,
                    (true, true) => 2519,
                    (false, false) => 2767,
                    (false, true) => 2768,
                });
            }
            return Iter3::default();
        }
        // The method of that name of the global `Generator` or `Iterator` itself goes by their type arguments, in which what may be
        // left out is not `undefined`.
        if let TypeData::Fns { decls, mapper } = self.data(method)
            && let [(of, func)] = decls[..]
            && let FnOwner::Member(member) = self.bound(of).fns[func.idx()].owner
            && let crate::bind::MemberOwner::Interface(interface) =
                self.bound(of).member_owner[member.idx()]
            && self.hir(of)[member].key.name() == Some(name)
        {
            let mapper = *mapper;
            let owner = self
                .files()
                .sym(of, self.bound(of).interface_symbol[interface.idx()]);
            let (generator, iterator) = if is_async {
                (known::AsyncGenerator, known::AsyncIterator)
            } else {
                (known::Generator, known::Iterator)
            };
            // The mapper of a method is about the type parameters of the declaration it is written in.
            let own = self.hir(of)[interface].type_params;
            if own.len() == 3
                && (self.global_type_of_arity(generator, 3) == Some(owner)
                    || self.global_type_of_arity(iterator, 3) == Some(owner))
            {
                let (y, r, n) = (
                    self.type_param(of, own.at(0)),
                    self.type_param(of, own.at(1)),
                    self.type_param(of, own.at(2)),
                );
                return Iter3 {
                    y: Some(self.instantiate(y, mapper)),
                    r: Some(self.instantiate(r, mapper)),
                    n: if is_next {
                        Some(self.instantiate(n, mapper))
                    } else {
                        None
                    },
                };
            }
        }
        let (mut parameters, mut results) = (Vec::new(), Vec::new());
        for &sig in &signatures {
            let params = self.sig_params(sig);
            if which != IteratorMethod::Throw && !params.is_empty() {
                // `getTypeAtPosition`
                parameters.push(self.param_type_at(&params, 0).unwrap_or(TypeId::ANY));
            }
            results.push(self.sig_return(sig));
        }
        let mut returned = Vec::new();
        let mut next = None;
        if which != IteratorMethod::Throw {
            let parameter = if parameters.is_empty() {
                TypeId::UNKNOWN
            } else {
                self.union(&parameters)
            };
            if is_next {
                // What `next` is given is not awaited, what `return` is given is.
                next = Some(parameter);
            } else {
                returned.push(if is_async {
                    self.awaited(parameter)
                } else {
                    parameter
                });
            }
        }
        let result = self.intersection(&results);
        let result = if is_async {
            self.awaited(result)
        } else {
            result
        };
        let types = self.iteration_types_of_iterator_result(result);
        let mut yielded = types.y;
        if types.has_types() {
            returned.extend(types.r);
        } else {
            if let Some(said) = said {
                said.push(if is_async { 2547 } else { 2490 });
            }
            yielded = Some(TypeId::ANY);
            returned.push(TypeId::ANY);
        }
        Iter3 {
            y: yielded,
            r: if returned.is_empty() {
                None
            } else {
                Some(self.union(&returned))
            },
            n: next,
        }
    }

    /// `getIterationTypesOfIteratorResult`: what `ty`, which `next` gives, says is yielded and returned.
    fn iteration_types_of_iterator_result(&mut self, ty: TypeId) -> Iter3 {
        let ty = self.force(ty);
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        if let Some(name) = self.files().atoms.lookup(b"IteratorYieldResult")
            && let Some(&[value]) = self.is_global_ref(ty, name)
        {
            return Iter3 {
                y: Some(value),
                ..Iter3::default()
            };
        }
        if let Some(name) = self.files().atoms.lookup(b"IteratorReturnResult")
            && let Some(&[value]) = self.is_global_ref(ty, name)
        {
            return Iter3 {
                r: Some(value),
                ..Iter3::default()
            };
        }
        let yielded = self.value_of_iterator_results(ty, TypeId::FALSE);
        let returned = self.value_of_iterator_results(ty, TypeId::TRUE);
        if yielded.is_none() && returned.is_none() {
            return Iter3::default();
        }
        // An iterator that returns nothing may leave `value` out at the end.
        Iter3 {
            y: yielded,
            r: Some(returned.unwrap_or(TypeId::VOID)),
            n: None,
        }
    }

    /// The `value` of the members of `ty` whose `done` can be `done`, which is `false` while it goes on and `true` at the end
    /// (`isIteratorResult`). Left out, it is `false`.
    fn value_of_iterator_results(&mut self, ty: TypeId, done: TypeId) -> Option<TypeId> {
        let results = self.filter(ty, |c, m| {
            let declared = c
                .declared_property(m, known::done)
                .map_or(TypeId::FALSE, |found| found.0);
            c.is_assignable(done, declared)
        });
        if results == TypeId::NEVER {
            None
        } else {
            self.declared_property(results, known::value)
                .map(|found| found.0)
        }
    }
}
