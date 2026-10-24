use super::answers::{
    CheckedType, ClassDeclaration, ClassMember, ClassMemberSource, ClassParent, ClassRef,
    ClassShape, FunctionRef, GaveUp, MemberName, ObjectMemberKind, PositionTypes,
};
use super::prototype_links::{LinkEnd, PrototypeLink, PrototypeLinks, list_in};
use super::queries::Queries;
use super::type_identity::ObjectOrigin;
use crate::atom::{Atom, known};
use crate::bind::{Decl, SymFlags};
use crate::hir::{
    self, ClassId, ExprId, ExprKind, FileKind, Flags, FnId, FnKind, ModuleName, PropKey, PropKind,
    StmtKind,
};
use crate::node::NodeData;
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::types::{TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::rc::Rc;

const MAX_NESTED_FOLLOWED_CALLS: usize = 8;
const MAX_CHAIN_OF_PARENTS: usize = 64;
const MAX_FUNCTIONS_GIVEN_THIS: usize = 32;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct FunctionLink {
    child: FnId,
    parent: Option<ClassParent>,
}

pub(super) struct LinkedFunctions<'s> {
    links: &'s [FunctionLink],
    ends: &'s [FnId],
}

impl<'s> LinkedFunctions<'s> {
    fn new(arena: &'s Arena, file: FileId, links: &[PrototypeLink]) -> LinkedFunctions<'s> {
        let find_function_in_file = |end: LinkEnd| match end {
            LinkEnd::Declaration(ClassDeclaration::Function(function)) if function.file == file => {
                Some(function.function)
            }
            _ => None,
        };
        let mut of_functions = Vec::new();
        let mut ends = Vec::new();
        for link in links {
            ends.extend(link.parent.and_then(find_function_in_file));
            let Some(child) = find_function_in_file(link.child) else {
                continue;
            };
            ends.push(child);
            let parent = link.parent.and_then(LinkEnd::as_parent);
            of_functions.push(FunctionLink { child, parent });
        }
        of_functions.sort_by_key(|link| link.child);
        ends.sort_unstable();
        ends.dedup();
        LinkedFunctions {
            links: list_in(arena, &of_functions),
            ends: list_in(arena, &ends),
        }
    }

    fn links_of(&self, function: FnId) -> &'s [FunctionLink] {
        let links = self.links;
        let start = links.partition_point(|link| link.child < function);
        let len = links[start..].partition_point(|link| link.child == function);
        &links[start..start + len]
    }

    fn find_only_parent(&self, function: FnId) -> Option<ClassParent> {
        let mut links = self.links_of(function).iter();
        let parent = links.next()?.parent?;
        links
            .all(|link| link.parent == Some(parent))
            .then_some(parent)
    }

    fn is_end(&self, function: FnId) -> bool {
        self.ends.binary_search(&function).is_ok()
    }
}

#[derive(Default)]
struct FollowedCalls {
    links_of_parameters: FxHashMap<FunctionRef, Rc<[PrototypeLink]>>,
    in_progress: Vec<FunctionRef>,
}

fn can_be_constructor_function(function: &hir::Func) -> bool {
    matches!(function.kind, FnKind::Decl | FnKind::Expr)
        && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
}

fn find_position(hir: &hir::File<'_>, source: ClassMemberSource) -> u32 {
    match source {
        ClassMemberSource::Member(member) => hir[member].name_pos,
        ClassMemberSource::ParameterProperty(parameter) => hir[parameter].pos,
        ClassMemberSource::ThisStore(store)
        | ClassMemberSource::PrototypeStore(store)
        | ClassMemberSource::StaticStore(store) => hir[store].pos,
    }
}

fn find_store_into_this(member: &ClassMember) -> Option<ExprId> {
    match member.source {
        ClassMemberSource::ThisStore(store) if !member.is_static => Some(store),
        _ => None,
    }
}

struct MembersByPosition {
    instance_names: FxHashSet<MemberName>,
    by_position: Vec<(u32, ClassMember)>,
    names_stored_in_prototype: Vec<MemberName>,
}

impl MembersByPosition {
    fn add(&mut self, position: u32, member: ClassMember) {
        if self.instance_names.insert(member.name) {
            self.by_position.push((position, member));
        }
    }
}

fn find_ambient_module_around(hir: &hir::File<'_>, class: ClassId) -> Option<Atom> {
    let mut specifier = None;
    let mut node = hir.parent(hir.node(class));
    while node.is_some() {
        if let NodeData::Stmt(statement) = hir.data(node)
            && let StmtKind::Module(module) = hir[statement].kind
            && let ModuleName::String(name) = hir[module].name
        {
            specifier = Some(name);
        }
        node = hir.parent(node);
    }
    specifier
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub fn constructor_function_parent(&mut self, function: FunctionRef) -> Option<ClassParent> {
        let parent = self.find_linked_parent(function)?;
        let mut ancestor = parent;
        for _ in 0..MAX_CHAIN_OF_PARENTS {
            let ClassParent::Declared(ClassDeclaration::Function(linked)) = ancestor else {
                return Some(parent);
            };
            match self.find_linked_parent(linked) {
                Some(above) => ancestor = above,
                None => return Some(parent),
            }
        }
        None
    }

    pub fn class_parent(&mut self, class: ClassRef) -> Option<ClassParent> {
        let heritage = self.c.hir(class.file)[class.class].extends.some()?;
        let parent = self.end_finder(class.file).find_parent(heritage)?;
        (parent != ClassParent::Declared(ClassDeclaration::Class(class))).then_some(parent)
    }

    pub fn constructed_declaration(&mut self, file: FileId, callee: ExprId) -> Option<ClassParent> {
        self.end_finder(file).find_parent(callee)
    }

    pub fn library_declarations_of_type(&mut self, ty: TypeId) -> SmallVec<[ClassDeclaration; 1]> {
        let parts: SmallVec<[TypeId; 2]> = match self.c.data(ty) {
            TypeData::Intersection(parts) => parts.iter().copied().collect(),
            _ => smallvec![ty],
        };
        let origins = parts.into_iter().map(|part| self.object_origin(part));
        let origins: SmallVec<[ObjectOrigin; 2]> = origins.collect();
        let declarations = origins.into_iter().filter_map(|origin| match origin {
            ObjectOrigin::Symbol(class) => self.find_library_declaration_of_class(class),
            _ => None,
        });
        declarations.collect()
    }

    fn find_library_declaration_of_class(&self, class: Sym) -> Option<ClassDeclaration> {
        let files = self.files();
        if !files.flags(class).contains(SymFlags::CLASS) {
            return None;
        }
        let is_declared =
            |&(file, _): &(FileId, Decl)| files.hir(file).kind == FileKind::Declaration;
        if !files.decls_of(class).iter().all(is_declared) {
            return None;
        }
        let specifier = files
            .decls_of(class)
            .iter()
            .find_map(|&(file, declaration)| {
                let Decl::Class(declared) = declaration else {
                    return None;
                };
                find_ambient_module_around(files.hir(file), declared)
            })?;
        let name = files.symbol(class).name;
        let module = files.try_find_ambient_module(specifier)?;
        let exported =
            files.resolve_alias_as(files.namespace_member(module, name)?, SymFlags::TYPE)?;
        if files.canonical(exported) != files.canonical(class) {
            return None;
        }
        self.inputs
            .named_values
            .find_library_export(specifier, name)
    }

    pub fn is_prototype_object_used(&mut self, function: FunctionRef) -> bool {
        let Some(shape) = self.constructor_function_shape(function) else {
            return false;
        };
        !shape.names_stored_in_prototype.is_empty() || self.is_end_of_prototype_link(function)
    }

    pub(super) fn is_end_of_prototype_link(&mut self, function: FunctionRef) -> bool {
        self.linked_functions(function.file)
            .is_end(function.function)
    }

    fn find_linked_parent(&mut self, function: FunctionRef) -> Option<ClassParent> {
        self.linked_functions(function.file)
            .find_only_parent(function.function)
    }

    fn linked_functions(&mut self, file: FileId) -> &'s LinkedFunctions<'s> {
        let of_file = self.prototype_links(file);
        of_file
            .linked_functions
            .get_or_init(|| self.compute_linked_functions(file, of_file))
    }

    fn compute_linked_functions(
        &mut self,
        file: FileId,
        of_file: &'s PrototypeLinks<'s>,
    ) -> LinkedFunctions<'s> {
        let ends = self.end_finder(file);
        let mut followed = FollowedCalls::default();
        let mut links = of_file.links_of_declarations().to_vec();
        for &call in of_file.calls() {
            let Some(of_parameters) = self.find_links_of_parameters(call.callee, &mut followed)
            else {
                continue;
            };
            let of_arguments = of_parameters.iter();
            let of_arguments = of_arguments.filter_map(|&link| ends.apply_to_arguments(link, call));
            links.extend(of_arguments.filter(|link| matches!(link.child, LinkEnd::Declaration(_))));
        }
        LinkedFunctions::new(self.c.arena, file, &links)
    }

    fn find_links_of_parameters(
        &mut self,
        function: FunctionRef,
        followed: &mut FollowedCalls,
    ) -> Option<Rc<[PrototypeLink]>> {
        let of_file = self.prototype_links(function.file);
        let written = of_file.links_of_parameters_of(function.function);
        let calls = of_file.calls_passing_parameters_of(function.function);
        if written.is_empty() && calls.is_empty() {
            return None;
        }
        if let Some(known) = followed.links_of_parameters.get(&function) {
            return Some(Rc::clone(known));
        }
        if followed.in_progress.len() == MAX_NESTED_FOLLOWED_CALLS
            || followed.in_progress.contains(&function)
        {
            return None;
        }
        followed.in_progress.push(function);
        let ends = self.end_finder(function.file);
        let mut links: Vec<PrototypeLink> = written.iter().map(|&(_, link)| link).collect();
        for &(_, call) in calls {
            let Some(of_callee) = self.find_links_of_parameters(call.callee, followed) else {
                continue;
            };
            for &link in of_callee.iter() {
                let Some(link) = ends.apply_to_arguments(link, call) else {
                    continue;
                };
                let is_of_function = matches!(
                    link.child,
                    LinkEnd::Parameter { function: owner, .. } if owner == function.function
                );
                if is_of_function && !links.contains(&link) {
                    links.push(link);
                }
            }
        }
        followed.in_progress.pop();
        let links: Rc<[PrototypeLink]> = links.into();
        followed
            .links_of_parameters
            .insert(function, Rc::clone(&links));
        Some(links)
    }

    pub(super) fn complete_constructor_function_shape(
        &mut self,
        function: FunctionRef,
    ) -> Option<&'c ClassShape<'c>> {
        let of_file = self.prototype_links(function.file);
        if of_file.shares_prototype_object(function.function) {
            return None;
        }
        let own = self.own_constructor_function_shape(function);
        let calls = of_file.calls_passing_this_of(function.function);
        let literals = of_file.copied_literals_of(function.function);
        let stores_into_this_only =
            own.is_some_and(|own| own.names_stored_in_prototype.is_empty()) && literals.is_empty();
        if stores_into_this_only
            && !self.is_end_of_prototype_link(function)
            && !self.is_used_like_constructor(function)
        {
            return None;
        }
        if own.is_some() && calls.is_empty() && literals.is_empty() {
            return own;
        }
        let hir = self.c.hir(function.file);
        if own.is_none() {
            let is_prototype_object_used =
                !literals.is_empty() || self.is_end_of_prototype_link(function);
            if !is_prototype_object_used || !can_be_constructor_function(&hir[function.function]) {
                return None;
            }
        }
        let own_members = match own {
            Some(own) => own.members,
            None => &[],
        };
        let instance_members = own_members.iter().filter(|member| !member.is_static);
        let mut members = MembersByPosition {
            instance_names: instance_members.map(|member| member.name).collect(),
            by_position: Vec::from_iter(
                own_members
                    .iter()
                    .map(|&member| (find_position(hir, member.source), member)),
            ),
            names_stored_in_prototype: own
                .map_or(Vec::new(), |own| own.names_stored_in_prototype.to_vec()),
        };
        let mut given_this = vec![function];
        for &(_, call) in calls {
            let mut fields = Vec::new();
            self.add_fields_stored_by(call.callee, &mut given_this, &mut fields);
            for field in fields {
                let field = ClassMember {
                    source: ClassMemberSource::ThisStore(call.call),
                    is_optional: true,
                    ..field
                };
                members.add(hir[call.call].pos, field);
            }
        }
        for &(_, literal) in literals {
            self.add_copied_members(function.file, literal, &mut members);
        }
        members.by_position.sort_by_key(|&(position, _)| position);
        let names_stored_in_prototype = self.list(&members.names_stored_in_prototype);
        let members = Vec::from_iter(members.by_position.into_iter().map(|(_, member)| member));
        let shape: &'c ClassShape<'c> = self.arena.alloc(ClassShape {
            declaration: ClassDeclaration::Function(function),
            members: self.list(&members),
            names_stored_in_prototype,
            has_computed_instance_name: own.is_some_and(|own| own.has_computed_instance_name),
            has_computed_static_name: own.is_some_and(|own| own.has_computed_static_name),
        });
        Some(shape)
    }

    fn add_fields_stored_by(
        &mut self,
        function: FunctionRef,
        given_this: &mut Vec<FunctionRef>,
        fields: &mut Vec<ClassMember>,
    ) {
        if given_this.len() == MAX_FUNCTIONS_GIVEN_THIS || given_this.contains(&function) {
            return;
        }
        given_this.push(function);
        let hir = self.c.hir(function.file);
        let own_members = match self.own_constructor_function_shape(function) {
            Some(own) => own.members,
            None => &[],
        };
        let of_file = self.prototype_links(function.file);
        let mut calls = of_file
            .calls_passing_this_of(function.function)
            .iter()
            .peekable();
        for member in own_members {
            let Some(store) = find_store_into_this(member) else {
                continue;
            };
            while let Some(&(_, call)) =
                calls.next_if(|&&(_, call)| hir[call.call].pos < hir[store].pos)
            {
                self.add_fields_stored_by(call.callee, given_this, fields);
            }
            fields.push(*member);
        }
        for &(_, call) in calls {
            self.add_fields_stored_by(call.callee, given_this, fields);
        }
    }

    fn type_of_stored_value(&mut self, file: FileId, value: ExprId) -> CheckedType {
        match file == self.file {
            true => self.ask(|queries| {
                let ty = queries.c.type_of_expr(file, value);
                queries.resolved(ty)
            }),
            false => Err(GaveUp::Unresolved),
        }
    }

    fn add_copied_members(
        &mut self,
        file: FileId,
        literal: ExprId,
        members: &mut MembersByPosition,
    ) {
        let hir = self.c.hir(file);
        let ExprKind::Object(properties) = hir[literal].kind else {
            return;
        };
        for id in properties.iter() {
            let property = hir[id];
            let name = match hir.runtime_property_key(id) {
                PropKey::Name(name) if name != known::__proto__ => self.member_name(name),
                PropKey::Name(_) | PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {
                    continue;
                }
            };
            if property.kind != PropKind::Spread {
                members.names_stored_in_prototype.push(name);
            }
            if members.instance_names.contains(&name) {
                continue;
            }
            let is_method = matches!(
                hir[property.value].kind,
                ExprKind::Fn(function) if hir[function].kind != FnKind::Arrow
            );
            let (kind, is_stored_value) = match property.kind {
                PropKind::Spread => continue,
                PropKind::Getter | PropKind::Setter => (ObjectMemberKind::Field, false),
                PropKind::Method => (ObjectMemberKind::Method, true),
                PropKind::Init | PropKind::Shorthand if is_method => {
                    (ObjectMemberKind::Method, true)
                }
                PropKind::Init | PropKind::Shorthand => (ObjectMemberKind::Field, true),
            };
            let checked = match is_stored_value {
                true => self.type_of_stored_value(file, property.value),
                false => Ok(TypeId::ANY),
            };
            let member = ClassMember {
                name,
                kind,
                source: ClassMemberSource::PrototypeStore(property.value),
                types: PositionTypes::unwritten(checked),
                is_static: false,
                is_optional: true,
            };
            members.add(hir[property.value].pos, member);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::ClassId;

    const FILE: FileId = FileId(3);

    fn function_in(file: FileId, function: u32) -> ClassDeclaration {
        ClassDeclaration::Function(FunctionRef {
            file,
            function: FnId(function),
        })
    }

    fn function(function: u32) -> LinkEnd {
        LinkEnd::Declaration(function_in(FILE, function))
    }

    fn link(child: LinkEnd, parent: Option<LinkEnd>) -> PrototypeLink {
        PrototypeLink { child, parent }
    }

    #[test]
    fn one_parent_is_the_parent() {
        let arena = Arena::new();
        let links = [
            link(function(7), Some(function(1))),
            link(function(2), Some(function(1))),
            link(function(7), Some(function(1))),
        ];
        let linked = LinkedFunctions::new(&arena, FILE, &links);
        let parent = ClassParent::Declared(function_in(FILE, 1));
        assert_eq!(linked.find_only_parent(FnId(7)), Some(parent));
        assert_eq!(linked.find_only_parent(FnId(2)), Some(parent));
        assert_eq!(linked.find_only_parent(FnId(1)), None);
        assert_eq!(linked.ends, [FnId(1), FnId(2), FnId(7)]);
    }

    #[test]
    fn two_parents_are_no_parent() {
        let arena = Arena::new();
        let links = [
            link(function(4), Some(function(1))),
            link(function(4), Some(function(2))),
            link(function(5), Some(function(1))),
            link(function(5), None),
            link(function(6), None),
            link(function(6), Some(function(1))),
        ];
        let linked = LinkedFunctions::new(&arena, FILE, &links);
        for child in [4, 5, 6] {
            assert_eq!(linked.find_only_parent(FnId(child)), None);
            assert!(linked.is_end(FnId(child)));
        }
    }

    #[test]
    fn parameter_that_no_call_replaced_names_no_parent() {
        let arena = Arena::new();
        let parameter = LinkEnd::Parameter {
            function: FnId(9),
            index: 1,
        };
        let links = [
            link(function(4), Some(parameter)),
            link(parameter, Some(function(1))),
        ];
        let linked = LinkedFunctions::new(&arena, FILE, &links);
        assert_eq!(
            linked.links_of(FnId(4)),
            [FunctionLink {
                child: FnId(4),
                parent: None,
            }]
        );
        assert!(!linked.is_end(FnId(9)));
        assert!(linked.is_end(FnId(1)));
    }

    #[test]
    fn declarations_of_other_files_are_parents_only() {
        let arena = Arena::new();
        let other = FileId(8);
        let class = ClassDeclaration::Class(ClassRef {
            file: other,
            class: ClassId(0),
        });
        let links = [
            link(
                function(4),
                Some(LinkEnd::Declaration(function_in(other, 4))),
            ),
            link(function(5), Some(LinkEnd::Declaration(class))),
            link(
                LinkEnd::Declaration(function_in(other, 6)),
                Some(function(1)),
            ),
        ];
        let linked = LinkedFunctions::new(&arena, FILE, &links);
        let parent = ClassParent::Declared(function_in(other, 4));
        assert_eq!(linked.find_only_parent(FnId(4)), Some(parent));
        assert_eq!(
            linked.find_only_parent(FnId(5)),
            Some(ClassParent::Declared(class))
        );
        assert_eq!(linked.find_only_parent(FnId(6)), None);
        assert_eq!(linked.ends, [FnId(1), FnId(4), FnId(5)]);
    }

    #[test]
    fn declarations_of_the_library_are_parents_only() {
        let arena = Arena::new();
        let of_library = function_in(FILE, 1);
        let links = [
            link(function(4), Some(LinkEnd::LibraryDeclaration(of_library))),
            link(LinkEnd::LibraryDeclaration(of_library), Some(function(5))),
        ];
        let linked = LinkedFunctions::new(&arena, FILE, &links);
        assert_eq!(
            linked.find_only_parent(FnId(4)),
            Some(ClassParent::Library(of_library))
        );
        assert_eq!(linked.find_only_parent(FnId(1)), None);
        assert_eq!(linked.ends, [FnId(4), FnId(5)]);
    }
}
