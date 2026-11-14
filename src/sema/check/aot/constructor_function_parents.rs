use super::answers::{
    CheckedType, ClassDeclaration, ClassMember, ClassMemberSource, ClassParent, ClassRef,
    ClassShape, FunctionRef, GaveUp, MemberForm, MemberName, ObjectMemberKind, PositionTypes,
    QueryLimit, UnknownParent,
};
use super::prototype_links::{
    EndsOfArguments, FunctionCall, LinkEnd, PrototypeLink, PrototypeLinks, list_in,
};
use super::queries::Queries;
use super::type_identity::ObjectOrigin;
use super::type_shape::ShapeKind;
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
use crate::util::{FxHashMap, FxHashSet, SharedSort};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct FunctionLink {
    child: FnId,
    parent: Option<ClassParent>,
    unknown_parent: Option<UnknownParent>,
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
            if link.is_plain_literal {
                continue;
            }
            let parent = link.parent.and_then(LinkEnd::as_parent);
            let unknown_parent = match link.parent {
                Some(LinkEnd::Parameter { .. }) => Some(UnknownParent::Parameter),
                Some(LinkEnd::Value) => Some(UnknownParent::Value),
                _ => None,
            };
            of_functions.push(FunctionLink {
                child,
                parent,
                unknown_parent,
            });
        }
        of_functions.shared_sort_by_key(|link| link.child);
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
struct ParentsOfParameter {
    declared: Option<LinkEnd>,
    parameter: Option<LinkEnd>,
    is_unknown: bool,
}

#[derive(Default)]
struct LinksOfParameters {
    links: Vec<PrototypeLink>,
    parents: FxHashMap<LinkEnd, ParentsOfParameter>,
}

impl LinksOfParameters {
    fn add(&mut self, link: PrototypeLink) -> bool {
        if link.is_plain_literal {
            let is_new = !self.links.contains(&link);
            if is_new {
                self.links.push(link);
            }
            return is_new;
        }
        let parents = self.parents.entry(link.child).or_default();
        if parents.is_unknown {
            return false;
        }
        let kept = match link.parent {
            Some(LinkEnd::Parameter { .. }) => &mut parents.parameter,
            _ => &mut parents.declared,
        };
        if link.parent.is_some() && *kept == link.parent {
            return false;
        }
        let is_first_of_its_kind = link.parent.is_some() && kept.is_none();
        *kept = link.parent;
        parents.is_unknown = !is_first_of_its_kind;
        self.links.push(PrototypeLink {
            child: link.child,
            parent: link.parent.filter(|_| is_first_of_its_kind),
            is_plain_literal: false,
        });
        true
    }

    fn list(&self) -> Vec<PrototypeLink> {
        let is_parent_known = |link: &&PrototypeLink| !self.parents[&link.child].is_unknown;
        let links = self.links.iter();
        let links = links.filter(|link| link.parent.is_none() || is_parent_known(link));
        links.copied().collect()
    }
}

struct CallOfHelperClosedWithIt {
    caller: usize,
    call: FunctionCall,
    arguments: Option<EndsOfArguments>,
    links_taken: usize,
}

fn add_links_applied_to(
    arguments: &EndsOfArguments,
    caller: FunctionRef,
    of_callee: &[PrototypeLink],
    links: &mut LinksOfParameters,
) -> bool {
    let mut says_more = false;
    for &link in of_callee {
        let Some(link) = arguments.apply_to(link) else {
            continue;
        };
        let is_of_function = matches!(
            link.child,
            LinkEnd::Parameter { function: owner, .. } if owner == caller.function
        );
        if is_of_function {
            says_more |= links.add(link);
        }
    }
    says_more
}

struct HelperOnTheWay<'s> {
    function: FunctionRef,
    calls: &'s [(FnId, FunctionCall)],
    next_call: usize,
    number: u32,
    lowest_number_led_back_to: u32,
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
        for _ in 0..self.limit(QueryLimit::ConstructorParentsFollowed) {
            let above = match ancestor {
                ClassParent::Declared(ClassDeclaration::Function(linked)) => {
                    self.find_linked_parent(linked)
                }
                ClassParent::Declared(ClassDeclaration::Class(class)) => self.class_parent(class),
                ClassParent::Library(_) => None,
            };
            match above {
                Some(above) => ancestor = above,
                None => return Some(parent),
            }
        }
        self.note_walk_ended_by(QueryLimit::ConstructorParentsFollowed);
        None
    }

    pub fn unknown_parent_of_function(&mut self, function: FunctionRef) -> Option<UnknownParent> {
        let links = self
            .linked_functions(function.file)
            .links_of(function.function);
        links.iter().find_map(|link| link.unknown_parent)
    }

    pub fn unknown_parent_of_class(&mut self, class: ClassRef) -> Option<UnknownParent> {
        let heritage = self.c.hir(class.file)[class.class].extends.some()?;
        let ends = self.end_finder(class.file);
        match ends.find_end(heritage) {
            Some(parameter @ LinkEnd::Parameter { .. }) => {
                let calls = self.prototype_links(class.file).calls();
                let passed = ends.find_only_end_passed(calls, parameter);
                passed.is_none().then_some(UnknownParent::Parameter)
            }
            Some(_) => None,
            None if ends.is_parameter(heritage) => Some(UnknownParent::Parameter),
            None => ends.find_value(heritage).map(|_| UnknownParent::Value),
        }
    }

    pub fn class_parent(&mut self, class: ClassRef) -> Option<ClassParent> {
        let heritage = self.c.hir(class.file)[class.class].extends.some()?;
        let ends = self.end_finder(class.file);
        let parent = match ends.find_end(heritage)? {
            parameter @ LinkEnd::Parameter { .. } => {
                let calls = self.prototype_links(class.file).calls();
                ends.find_only_end_passed(calls, parameter)?
            }
            end => end,
        };
        let parent = parent.as_parent()?;
        (parent != ClassParent::Declared(ClassDeclaration::Class(class))).then_some(parent)
    }

    pub fn nearest_class_joined_in(&mut self, ty: TypeId) -> Option<ClassRef> {
        let TypeData::Intersection(parts) = self.c.data(ty) else {
            return None;
        };
        let first = *parts.first()?;
        match self.type_shape(first).ok()?.kind {
            ShapeKind::ClassConstructor(class) => Some(class),
            _ => None,
        }
    }

    pub fn library_declarations_of_type(&mut self, ty: TypeId) -> SmallVec<[ClassDeclaration; 1]> {
        let parts = match self.c.data(ty) {
            TypeData::Intersection(parts) => &parts[..],
            _ => std::slice::from_ref(&ty),
        };
        let mut declarations = SmallVec::new();
        for &part in parts {
            if let ObjectOrigin::Symbol(class) = self.object_origin(part)
                && let Some(declaration) = self.find_library_declaration_of_class(class)
            {
                declarations.push(declaration);
            }
        }
        declarations
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

    pub fn stores_into_instances_or_prototype_object(&mut self, function: FunctionRef) -> bool {
        let has_members = self
            .constructor_function_shape(function)
            .is_some_and(|shape| !shape.members.is_empty());
        has_members || self.is_prototype_object_used(function)
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
        let mut links = of_file.links_of_declarations().to_vec();
        for &call in of_file.calls() {
            let Some(of_parameters) = self.find_links_of_parameters(call.callee) else {
                continue;
            };
            if of_parameters.is_empty() {
                continue;
            }
            let arguments = ends.find_ends_of_arguments(call);
            let of_arguments = of_parameters.iter();
            let of_arguments = of_arguments.filter_map(|&link| arguments.apply_to(link));
            links.extend(of_arguments.filter(|link| matches!(link.child, LinkEnd::Declaration(_))));
        }
        for link in &mut links {
            if let Some(parent @ LinkEnd::Parameter { .. }) = link.parent
                && let Some(passed) = ends.find_only_end_passed(of_file.calls(), parent)
            {
                link.parent = Some(passed);
            }
        }
        LinkedFunctions::new(self.c.arena, file, &links)
    }

    fn links_or_hands_on_its_parameters(&mut self, function: FunctionRef) -> bool {
        let of_file = self.prototype_links(function.file);
        !of_file.links_of_parameters_of(function.function).is_empty()
            || !of_file
                .calls_passing_parameters_of(function.function)
                .is_empty()
    }

    fn links_of_parameters_found(&mut self, function: FunctionRef) -> Option<&'s [PrototypeLink]> {
        let of_file = self.prototype_links(function.file);
        of_file.links_of_parameters_followed_of(function.function)
    }

    fn find_links_of_parameters(&mut self, asked: FunctionRef) -> Option<&'s [PrototypeLink]> {
        if !self.links_or_hands_on_its_parameters(asked) {
            return None;
        }
        if let Some(found) = self.links_of_parameters_found(asked) {
            return Some(found);
        }
        let mut numbers: FxHashMap<FunctionRef, u32> = FxHashMap::default();
        let mut open: Vec<FunctionRef> = Vec::new();
        let mut way: Vec<HelperOnTheWay<'s>> = Vec::new();
        let mut entered = Some(asked);
        loop {
            if let Some(function) = entered.take() {
                let number = numbers.len() as u32;
                numbers.insert(function, number);
                open.push(function);
                let of_file = self.prototype_links(function.file);
                way.push(HelperOnTheWay {
                    function,
                    calls: of_file.calls_passing_parameters_of(function.function),
                    next_call: 0,
                    number,
                    lowest_number_led_back_to: number,
                });
            }
            let Some(helper) = way.last_mut() else {
                break;
            };
            if let Some(&(_, call)) = helper.calls.get(helper.next_call) {
                helper.next_call += 1;
                if let Some(&number) = numbers.get(&call.callee) {
                    if self.links_of_parameters_found(call.callee).is_none()
                        && let Some(helper) = way.last_mut()
                    {
                        helper.lowest_number_led_back_to =
                            helper.lowest_number_led_back_to.min(number);
                    }
                } else if self.links_or_hands_on_its_parameters(call.callee)
                    && self.links_of_parameters_found(call.callee).is_none()
                {
                    entered = Some(call.callee);
                }
                continue;
            }
            let Some(left) = way.pop() else {
                break;
            };
            if let Some(caller) = way.last_mut() {
                caller.lowest_number_led_back_to =
                    (caller.lowest_number_led_back_to).min(left.lowest_number_led_back_to);
            }
            if left.lowest_number_led_back_to == left.number {
                let first = open.iter().rposition(|&function| function == left.function);
                let together = open.split_off(first.expect("the helper is open"));
                self.close_helpers_that_lead_back_to_one_another(&together);
            }
        }
        self.links_of_parameters_found(asked)
    }

    fn add_links_of_callee(
        &self,
        caller: FunctionRef,
        call: FunctionCall,
        of_callee: &[PrototypeLink],
        links: &mut LinksOfParameters,
    ) {
        if !of_callee.is_empty() {
            let arguments = self.end_finder(caller.file).find_ends_of_arguments(call);
            add_links_applied_to(&arguments, caller, of_callee, links);
        }
    }

    fn close_helpers_that_lead_back_to_one_another(&mut self, together: &[FunctionRef]) {
        let places: FxHashMap<FunctionRef, usize> = match together {
            [_] => FxHashMap::default(),
            _ => together.iter().copied().zip(0..).collect(),
        };
        let find_place = |function: FunctionRef| match together {
            &[only] => (only == function).then_some(0),
            _ => places.get(&function).copied(),
        };
        let mut links_of: Vec<LinksOfParameters> = Vec::new();
        links_of.resize_with(together.len(), LinksOfParameters::default);
        let mut callers_of: Vec<Vec<CallOfHelperClosedWithIt>> = Vec::new();
        callers_of.resize_with(together.len(), Vec::new);
        let mut waiting: Vec<usize> = Vec::new();
        for (place, &function) in together.iter().enumerate() {
            let of_file = self.prototype_links(function.file);
            for &(_, link) in of_file.links_of_parameters_of(function.function) {
                links_of[place].add(link);
            }
            for &(_, call) in of_file.calls_passing_parameters_of(function.function) {
                if let Some(callee) = find_place(call.callee) {
                    callers_of[callee].push(CallOfHelperClosedWithIt {
                        caller: place,
                        call,
                        arguments: None,
                        links_taken: 0,
                    });
                } else if let Some(of_callee) = self.links_of_parameters_found(call.callee) {
                    self.add_links_of_callee(function, call, of_callee, &mut links_of[place]);
                }
            }
        }
        let has_callers: Vec<bool> = callers_of.iter().map(|calls| !calls.is_empty()).collect();
        let mut is_waiting = has_callers.clone();
        waiting.extend((0..together.len()).filter(|&place| has_callers[place]));
        while let Some(callee) = waiting.pop() {
            is_waiting[callee] = false;
            for inside in &mut callers_of[callee] {
                let new_links = links_of[callee].links[inside.links_taken..].to_vec();
                if new_links.is_empty() {
                    continue;
                }
                inside.links_taken += new_links.len();
                let caller = together[inside.caller];
                let arguments = inside.arguments.get_or_insert_with(|| {
                    self.end_finder(caller.file)
                        .find_ends_of_arguments(inside.call)
                });
                let links = &mut links_of[inside.caller];
                let says_more = add_links_applied_to(arguments, caller, &new_links, links);
                if says_more && has_callers[inside.caller] && !is_waiting[inside.caller] {
                    is_waiting[inside.caller] = true;
                    waiting.push(inside.caller);
                }
            }
        }
        for (&function, links) in together.iter().zip(&links_of) {
            let links = list_in(self.c.arena, &links.list());
            let of_file = self.prototype_links(function.file);
            of_file.keep_links_of_parameters_followed(function.function, links);
        }
    }

    /// The functions of the file that pass their receiver to `function`, which may be stored under `name`.
    pub fn functions_passing_receiver(
        &mut self,
        function: FunctionRef,
        name: Option<Atom>,
    ) -> Vec<FnId> {
        let of_file = self.prototype_links(function.file);
        let passed = of_file.receivers_passed_to(function.function).iter();
        let mut callers: Vec<FnId> = passed.map(|&(_, caller)| caller).collect();
        if let Some(name) = name {
            let passed_by_name = of_file.receivers_passed_by_name(name).iter();
            callers.extend(passed_by_name.map(|&(_, caller)| caller));
        }
        callers
    }

    pub(super) fn passes_this_on_in_front_of(
        &mut self,
        function: FunctionRef,
        source: ClassMemberSource,
    ) -> bool {
        let of_file = self.prototype_links(function.file);
        let calls = of_file.calls_passing_this_of(function.function);
        let hir = self.c.hir(function.file);
        let position = find_position(hir, source);
        calls.iter().any(|&(_, call)| hir[call.call].pos < position)
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
            if !can_be_constructor_function(&hir[function.function]) {
                return None;
            }
            let is_prototype_object_used =
                !literals.is_empty() || self.is_end_of_prototype_link(function);
            if !is_prototype_object_used
                && !(self.hands_this_on(function)
                    && self.is_held_by_name_or_returned(function)
                    && self.is_used_like_constructor(function))
            {
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
            let is_unconditional = self.is_evaluated_in_every_construction(function, call.call);
            self.add_fields_stored_by(call.callee, is_unconditional, &mut given_this, &mut fields);
            for field in fields {
                let field = ClassMember {
                    source: ClassMemberSource::ThisStore(call.call),
                    ..field
                };
                members.add(hir[call.call].pos, field);
            }
        }
        for &(_, literal) in literals {
            self.add_copied_members(function.file, literal, &mut members);
        }
        members
            .by_position
            .shared_sort_by_key(|&(position, _)| position);
        let names_stored_in_prototype = self.list(&members.names_stored_in_prototype);
        let members = Vec::from_iter(members.by_position.into_iter().map(|(_, member)| member));
        let shape: &'c ClassShape<'c> = self.arena.alloc(ClassShape {
            declaration: ClassDeclaration::Function(function),
            members: self.list(&members),
            names_stored_in_prototype,
            has_computed_instance_name: own.is_some_and(|own| own.has_computed_instance_name),
        });
        Some(shape)
    }

    fn add_fields_stored_by(
        &mut self,
        function: FunctionRef,
        is_unconditional: bool,
        given_this: &mut Vec<FunctionRef>,
        fields: &mut Vec<ClassMember>,
    ) {
        if given_this.contains(&function) {
            return;
        }
        if given_this.len() as u64 >= self.limit(QueryLimit::FunctionsGivenThis) {
            self.note_walk_ended_by(QueryLimit::FunctionsGivenThis);
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
                let is_unconditional =
                    is_unconditional && self.is_evaluated_before_returns(function, call.call);
                self.add_fields_stored_by(call.callee, is_unconditional, given_this, fields);
            }
            let is_stored = !member.is_optional
                && is_unconditional
                && self.is_evaluated_before_returns(function, store);
            fields.push(ClassMember {
                is_optional: !is_stored,
                ..*member
            });
        }
        for &(_, call) in calls {
            let is_unconditional =
                is_unconditional && self.is_evaluated_before_returns(function, call.call);
            self.add_fields_stored_by(call.callee, is_unconditional, given_this, fields);
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
                is_made_at_birth: false,
                types: PositionTypes::unwritten(checked),
                is_static: false,
                is_optional: true,
                may_be_defined_above: false,
                form: MemberForm::default(),
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
        PrototypeLink {
            child,
            parent,
            is_plain_literal: false,
        }
    }

    fn parameter(index: u32) -> LinkEnd {
        LinkEnd::Parameter {
            function: FnId(9),
            index,
        }
    }

    #[test]
    fn two_declared_parents_of_a_parameter_are_an_unknown_parent() {
        let mut links = LinksOfParameters::default();
        assert!(links.add(link(parameter(0), Some(function(1)))));
        assert!(!links.add(link(parameter(0), Some(function(1)))));
        assert!(links.add(link(parameter(3), Some(function(2)))));
        assert!(links.add(link(parameter(0), Some(function(2)))));
        let kept = [
            link(parameter(3), Some(function(2))),
            link(parameter(0), None),
        ];
        assert_eq!(links.list(), kept);
        for parent in [
            Some(function(1)),
            Some(function(5)),
            Some(parameter(2)),
            None,
        ] {
            assert!(!links.add(link(parameter(0), parent)));
        }
        assert_eq!(links.list(), kept);
    }

    #[test]
    fn a_parent_that_is_a_parameter_stands_beside_a_declared_one_until_the_call() {
        let mut links = LinksOfParameters::default();
        assert!(links.add(link(parameter(0), Some(parameter(1)))));
        assert!(links.add(link(parameter(0), Some(function(1)))));
        assert!(!links.add(link(parameter(0), Some(parameter(1)))));
        assert!(!links.add(link(parameter(0), Some(function(1)))));
        assert_eq!(
            links.list(),
            [
                link(parameter(0), Some(parameter(1))),
                link(parameter(0), Some(function(1))),
            ]
        );
        assert!(links.add(link(parameter(0), None)));
        assert_eq!(links.list(), [link(parameter(0), None)]);
    }

    #[test]
    fn two_parents_of_a_parameter_that_are_parameters_are_an_unknown_parent() {
        let mut links = LinksOfParameters::default();
        assert!(links.add(link(parameter(0), Some(parameter(1)))));
        assert!(links.add(link(parameter(1), Some(parameter(2)))));
        assert!(links.add(link(parameter(0), Some(parameter(2)))));
        let kept = [
            link(parameter(1), Some(parameter(2))),
            link(parameter(0), None),
        ];
        assert_eq!(links.list(), kept);
        assert!(!links.add(link(parameter(0), Some(parameter(1)))));
        assert_eq!(links.list(), kept);
    }

    #[test]
    fn what_is_kept_of_a_parameter_does_not_depend_on_the_order_of_its_links() {
        let parents = [
            Some(function(1)),
            Some(parameter(1)),
            Some(function(2)),
            Some(parameter(2)),
            Some(function(1)),
        ];
        for first in 0..parents.len() {
            let mut links = LinksOfParameters::default();
            for step in 0..parents.len() {
                links.add(link(parameter(0), parents[(first + step) % parents.len()]));
            }
            assert_eq!(links.list(), [link(parameter(0), None)], "{first}");
        }
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
                unknown_parent: Some(UnknownParent::Parameter),
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
