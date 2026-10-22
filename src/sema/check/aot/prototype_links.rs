use super::answers::{ClassDeclaration, ClassParent, ClassRef, FunctionRef};
use super::constructor_function_parents::LinkedFunctions;
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingKind, Bound, Decl, Parent, PatParent, SymbolId};
use crate::check::Program;
use crate::hir::{
    self, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, IdList, MemberKey, PatKind, PropId, Span,
    is_proto_setter,
};
use crate::program::FileId;
use crate::session::Arena;
use crate::util::FxHashSet;
use std::sync::OnceLock;

// What a call of a function does. The numbers are positions of arguments.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum PrototypeOperation {
    // `parent` becomes the prototype of `object`, which is the result where the call has one.
    SetPrototype { object: u32, parent: u32 },
    // The result is a new object whose prototype is `parent`.
    CreateObject { parent: u32 },
    // The prototype object of the function `child` inherits from the prototype object of the function `parent`.
    LinkClasses { child: u32, parent: u32 },
    // The properties of the arguments behind `target` are stored into `target`, which is the result.
    CopyProperties { target: u32 },
    // The callee is a member of a function, which is called with `receiver` as its `this`.
    CallFunction { receiver: u32 },
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum NamedValue {
    Class(ClassRef),
    Function(FunctionRef),
    PrototypeOperation(PrototypeOperation),
}

// What an expression names, decided by the bindings of the program and by nothing else.
pub trait NamedValues: Sync {
    fn find_named_value(&self, file: FileId, expression: ExprId) -> Option<NamedValue>;

    // The class or the function of Bun's own modules that an expression of another program names. Its file is one of theirs.
    fn find_library_declaration(&self, _: FileId, _: ExprId) -> Option<ClassDeclaration> {
        None
    }

    // The class or the function that the module of Bun's own with this specifier exports under the name.
    fn find_library_export(&self, _specifier: Atom, _name: Atom) -> Option<ClassDeclaration> {
        None
    }
}

// A parameter is one of a function of the file whose text has the link.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum LinkEnd {
    Declaration(ClassDeclaration),
    LibraryDeclaration(ClassDeclaration),
    Parameter { function: FnId, index: u32 },
}

impl LinkEnd {
    pub(super) fn as_parent(self) -> Option<ClassParent> {
        match self {
            LinkEnd::Declaration(declaration) => Some(ClassParent::Declared(declaration)),
            LinkEnd::LibraryDeclaration(declaration) => Some(ClassParent::Library(declaration)),
            LinkEnd::Parameter { .. } => None,
        }
    }
}

// The prototype object of `child` gets the prototype object of `parent` as its prototype.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct PrototypeLink {
    pub(super) child: LinkEnd,
    pub(super) parent: Option<LinkEnd>,
}

#[derive(Copy, Clone)]
pub(super) struct FunctionCall {
    pub(super) call: ExprId,
    pub(super) callee: FunctionRef,
}

// What the text of one file says.
pub(in crate::check) struct PrototypeLinks<'s> {
    links_of_declarations: &'s [PrototypeLink],
    links_of_parameters: &'s [(FnId, PrototypeLink)],
    calls: &'s [FunctionCall],
    calls_passing_parameters: &'s [(FnId, FunctionCall)],
    calls_passing_this: &'s [(FnId, FunctionCall)],
    copied_literals: &'s [(FnId, ExprId)],
    pub(super) linked_functions: OnceLock<LinkedFunctions<'s>>,
    pub(super) declarations_used_like_constructors: OnceLock<&'s [SymbolId]>,
}

fn entries_of<T>(entries: &[(FnId, T)], function: FnId) -> &[(FnId, T)] {
    let start = entries.partition_point(|entry| entry.0 < function);
    let len = entries[start..].partition_point(|entry| entry.0 == function);
    &entries[start..start + len]
}

impl<'s> PrototypeLinks<'s> {
    pub(super) fn links_of_declarations(&self) -> &'s [PrototypeLink] {
        self.links_of_declarations
    }

    pub(super) fn links_of_parameters_of(&self, function: FnId) -> &'s [(FnId, PrototypeLink)] {
        entries_of(self.links_of_parameters, function)
    }

    pub(super) fn calls(&self) -> &'s [FunctionCall] {
        self.calls
    }

    pub(super) fn calls_passing_parameters_of(&self, function: FnId) -> &'s [(FnId, FunctionCall)] {
        entries_of(self.calls_passing_parameters, function)
    }

    // In the order of the text.
    pub(super) fn calls_passing_this_of(&self, function: FnId) -> &'s [(FnId, FunctionCall)] {
        entries_of(self.calls_passing_this, function)
    }

    // The object literals whose properties are copied into the prototype object of `function`, in the order of the text.
    pub(super) fn copied_literals_of(&self, function: FnId) -> &'s [(FnId, ExprId)] {
        entries_of(self.copied_literals, function)
    }
}

impl<'s> Program<'s> {
    fn aot_prototype_links_of(&self, file: FileId) -> &'s OnceLock<PrototypeLinks<'s>> {
        let of_files: &'s [OnceLock<PrototypeLinks<'s>>] =
            *self.aot_prototype_links.get_or_init(|| {
                let arena = self.session.arena();
                &*arena.alloc_slice_fill_default(self.files.modules.len())
            });
        &of_files[file.idx()]
    }
}

pub(super) fn list_in<'s, T: Copy>(arena: &'s Arena, items: &[T]) -> &'s [T] {
    match items.is_empty() {
        true => &[],
        false => arena.alloc_slice_copy(items),
    }
}

#[derive(Copy, Clone)]
pub(super) struct EndFinder<'c, 'p, 's> {
    file: FileId,
    hir: &'p hir::File<'s>,
    bound: &'p Bound<'s>,
    named_values: &'c dyn NamedValues,
}

impl EndFinder<'_, '_, '_> {
    fn find_parameter(&self, reference: ExprId) -> Option<LinkEnd> {
        let Binding::Symbol(symbol) = self.bound.binding(reference) else {
            return None;
        };
        if self.bound.binding_kind(symbol) != BindingKind::Parameter
            || !self.bound.is_stable_binding(symbol)
        {
            return None;
        }
        let &[Decl::Param(pattern)] = self.bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Param(parameter) = self.bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let is_plain_name = matches!(self.hir[pattern].kind, PatKind::Ident(_))
            && !self.hir[parameter].flags.contains(Flags::REST);
        let function = self.bound.param_fn[parameter.idx()];
        if !is_plain_name || function == FnId::NONE {
            return None;
        }
        let mut parameters = self.hir[function].params.iter();
        let index = parameters.position(|it| it == parameter)? as u32;
        Some(LinkEnd::Parameter { function, index })
    }

    fn find_referenced_parameter(&self, expression: ExprId) -> Option<LinkEnd> {
        let expression = self.hir.skip_type_assertions(expression);
        match self.hir[expression].kind {
            ExprKind::Ident(_) => self.find_parameter(expression),
            _ => None,
        }
    }

    fn find_end(&self, expression: ExprId) -> Option<LinkEnd> {
        if let Some(parameter) = self.find_referenced_parameter(expression) {
            return Some(parameter);
        }
        match self.named_values.find_named_value(self.file, expression) {
            Some(NamedValue::Class(class)) => {
                Some(LinkEnd::Declaration(ClassDeclaration::Class(class)))
            }
            Some(NamedValue::Function(function)) => {
                Some(LinkEnd::Declaration(ClassDeclaration::Function(function)))
            }
            Some(NamedValue::PrototypeOperation(_)) => None,
            None => {
                let declaration = self.named_values.find_library_declaration(self.file, expression);
                declaration.map(LinkEnd::LibraryDeclaration)
            }
        }
    }

    pub(super) fn find_parent(&self, heritage: ExprId) -> Option<ClassParent> {
        self.find_end(heritage)?.as_parent()
    }

    fn find_owner_of_prototype_object(&self, expression: ExprId) -> Option<LinkEnd> {
        match self.hir.member_key(self.hir.skip_type_assertions(expression))? {
            (owner, MemberKey::Name(name)) if name == known::prototype => self.find_end(owner),
            (_, MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_)) => None,
        }
    }

    fn arguments(&self, call: ExprId) -> impl Iterator<Item = ExprId> + Clone + '_ {
        let arguments = match self.hir[call].kind {
            ExprKind::Call(site) => self.hir[site].args,
            _ => IdList::EMPTY,
        };
        self.hir.ids(arguments)
    }

    fn is_spread(&self, argument: ExprId) -> bool {
        matches!(self.hir[argument].kind, ExprKind::Spread(_))
    }

    // `None`: the call has fewer arguments, or a spread argument comes first.
    fn find_argument(&self, call: ExprId, index: u32) -> Option<ExprId> {
        let mut arguments = self.arguments(call).take(index as usize + 1);
        if arguments.clone().any(|argument| self.is_spread(argument)) {
            return None;
        }
        arguments.nth(index as usize)
    }

    fn find_end_at(&self, call: ExprId, index: u32) -> Option<LinkEnd> {
        self.find_end(self.find_argument(call, index)?)
    }

    fn find_owner_of_prototype_object_at(&self, call: ExprId, index: u32) -> Option<LinkEnd> {
        self.find_owner_of_prototype_object(self.find_argument(call, index)?)
    }

    fn find_callee(&self, call: ExprId) -> Option<NamedValue> {
        let ExprKind::Call(site) = self.hir[call].kind else {
            return None;
        };
        self.named_values.find_named_value(self.file, self.hir[site].callee)
    }

    fn find_called_member(&self, call: ExprId) -> Option<(ExprId, MemberKey)> {
        let ExprKind::Call(site) = self.hir[call].kind else {
            return None;
        };
        self.hir.member_key(self.hir.skip_type_assertions(self.hir[site].callee))
    }

    fn find_parent_in_literal(&self, properties: Span<PropId>) -> Option<LinkEnd> {
        let mut properties = properties.iter();
        let parent = properties.find(|&property| is_proto_setter(&self.hir[property]))?;
        self.find_owner_of_prototype_object(self.hir[parent].value)
    }

    // The owner of the prototype object from which the object that `value` creates inherits.
    fn find_parent_of_created_object(&self, value: ExprId) -> Option<LinkEnd> {
        let value = self.hir.skip_type_assertions(value);
        if let ExprKind::New(site) = self.hir[value].kind {
            return self.find_end(self.hir[site].callee);
        }
        if let ExprKind::Object(properties) = self.hir[value].kind {
            return self.find_parent_in_literal(properties);
        }
        match self.find_callee(value)? {
            NamedValue::PrototypeOperation(
                PrototypeOperation::CreateObject { parent }
                | PrototypeOperation::SetPrototype { parent, .. },
            ) => self.find_owner_of_prototype_object_at(value, parent),
            NamedValue::PrototypeOperation(PrototypeOperation::CopyProperties { target }) => {
                self.find_parent_of_created_object(self.find_argument(value, target)?)
            }
            NamedValue::PrototypeOperation(
                PrototypeOperation::LinkClasses { .. } | PrototypeOperation::CallFunction { .. },
            )
            | NamedValue::Class(_)
            | NamedValue::Function(_) => None,
        }
    }

    // What `link`, which the file of the callee has in terms of the parameters of the callee, does to the arguments of `call`, which is a call in this file.
    pub(super) fn apply_to_arguments(
        &self,
        link: PrototypeLink,
        call: FunctionCall,
    ) -> Option<PrototypeLink> {
        let find_argument_for = |end: LinkEnd| match end {
            LinkEnd::Declaration(_) | LinkEnd::LibraryDeclaration(_) => Some(end),
            LinkEnd::Parameter { function, index } if function == call.callee.function => {
                self.find_end_at(call.call, index)
            }
            LinkEnd::Parameter { .. } => None,
        };
        Some(PrototypeLink {
            child: find_argument_for(link.child)?,
            parent: link.parent.and_then(find_argument_for),
        })
    }
}

struct CallPassingThis {
    this: ExprId,
    call: FunctionCall,
}

struct LinkCollector<'c, 'p, 's> {
    ends: EndFinder<'c, 'p, 's>,
    links: Vec<PrototypeLink>,
    known_links: FxHashSet<PrototypeLink>,
    calls: Vec<FunctionCall>,
    calls_passing_parameters: Vec<(FnId, FunctionCall)>,
    calls_passing_this: Vec<CallPassingThis>,
    copied_literals: Vec<(FnId, ExprId)>,
}

impl<'c, 'p, 's> LinkCollector<'c, 'p, 's> {
    fn new(ends: EndFinder<'c, 'p, 's>) -> Self {
        LinkCollector {
            ends,
            links: Vec::new(),
            known_links: FxHashSet::default(),
            calls: Vec::new(),
            calls_passing_parameters: Vec::new(),
            calls_passing_this: Vec::new(),
            copied_literals: Vec::new(),
        }
    }

    fn add_link(&mut self, child: Option<LinkEnd>, parent: Option<LinkEnd>) {
        let Some(child) = child else {
            return;
        };
        let link = PrototypeLink { child, parent };
        if self.known_links.insert(link) {
            self.links.push(link);
        }
    }

    fn add_copied_literals(&mut self, owner: Option<LinkEnd>, call: ExprId, target: u32) {
        let ends = self.ends;
        let Some(LinkEnd::Declaration(ClassDeclaration::Function(owner))) = owner else {
            return;
        };
        if owner.file != ends.file {
            return;
        }
        for source in ends.arguments(call).skip(target as usize + 1) {
            let source = ends.hir.skip_type_assertions(source);
            if matches!(ends.hir[source].kind, ExprKind::Object(_)) {
                self.copied_literals.push((owner.function, source));
            }
        }
    }

    fn visit_call_passing_receiver(&mut self, call: ExprId, receiver: u32) {
        let ends = self.ends;
        let Some(receiver) = ends.find_argument(call, receiver) else {
            return;
        };
        let this = ends.hir.skip_type_assertions(receiver);
        if !matches!(ends.hir[this].kind, ExprKind::This) {
            return;
        }
        let Some((function, _)) = ends.find_called_member(call) else {
            return;
        };
        if let Some(NamedValue::Function(callee)) =
            ends.named_values.find_named_value(ends.file, function)
        {
            let call = FunctionCall { call, callee };
            self.calls_passing_this.push(CallPassingThis { this, call });
        }
    }

    fn visit_function_call(&mut self, call: FunctionCall) {
        let ends = self.ends;
        if ends.find_argument(call.call, 0).is_none() {
            return;
        }
        self.calls.push(call);
        let first_of_call = self.calls_passing_parameters.len();
        let arguments = ends.arguments(call.call);
        for argument in arguments.take_while(|&argument| !ends.is_spread(argument)) {
            let Some(LinkEnd::Parameter { function, .. }) =
                ends.find_referenced_parameter(argument)
            else {
                continue;
            };
            let of_call = &self.calls_passing_parameters[first_of_call..];
            if of_call.iter().all(|entry| entry.0 != function) {
                self.calls_passing_parameters.push((function, call));
            }
        }
    }

    fn visit_operation(&mut self, call: ExprId, operation: PrototypeOperation) {
        let ends = self.ends;
        match operation {
            PrototypeOperation::SetPrototype { object, parent } => {
                let child = ends.find_owner_of_prototype_object_at(call, object);
                self.add_link(child, ends.find_owner_of_prototype_object_at(call, parent));
            }
            PrototypeOperation::LinkClasses { child, parent } => {
                let child = ends.find_end_at(call, child);
                self.add_link(child, ends.find_end_at(call, parent));
            }
            PrototypeOperation::CopyProperties { target } => {
                let owner = ends.find_owner_of_prototype_object_at(call, target);
                self.add_copied_literals(owner, call, target);
            }
            PrototypeOperation::CallFunction { receiver } => {
                self.visit_call_passing_receiver(call, receiver);
            }
            PrototypeOperation::CreateObject { .. } => {}
        }
    }

    fn visit_call(&mut self, call: ExprId) {
        match self.ends.find_callee(call) {
            Some(NamedValue::PrototypeOperation(operation)) => {
                self.visit_operation(call, operation);
            }
            Some(NamedValue::Function(callee)) => {
                self.visit_function_call(FunctionCall { call, callee });
            }
            Some(NamedValue::Class(_)) => {}
            // No binding names a member of a function of the program. Such a function inherits `call` and `apply`.
            None => match self.ends.find_called_member(call) {
                Some((_, MemberKey::Name(name))) if name == known::call || name == known::apply => {
                    self.visit_call_passing_receiver(call, 0);
                }
                Some((_, MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_)))
                | None => {}
            },
        }
    }

    fn visit_store(&mut self, target: ExprId, value: ExprId) {
        let ends = self.ends;
        let Some((object, MemberKey::Name(name))) = ends.hir.member_key(target) else {
            return;
        };
        if name == known::prototype {
            let child = ends.find_end(object);
            self.add_link(child, ends.find_parent_of_created_object(value));
            let copy = ends.hir.skip_type_assertions(value);
            if let Some(NamedValue::PrototypeOperation(operation)) = ends.find_callee(copy)
                && let PrototypeOperation::CopyProperties { target } = operation
            {
                self.add_copied_literals(child, copy, target);
            }
        } else if name == known::__proto__ {
            let child = ends.find_owner_of_prototype_object(object);
            self.add_link(child, ends.find_owner_of_prototype_object(value));
        }
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn prototype_links(&mut self, file: FileId) -> &'s PrototypeLinks<'s> {
        let of_file = self.c.p.aot_prototype_links_of(file);
        of_file.get_or_init(|| self.compute_prototype_links(file))
    }

    pub(super) fn end_finder(&self, file: FileId) -> EndFinder<'c, 'p, 's> {
        EndFinder {
            file,
            hir: self.c.hir(file),
            bound: self.c.bound(file),
            named_values: self.inputs.named_values,
        }
    }

    fn find_function_of_this(&self, file: FileId, this: ExprId) -> Option<FnId> {
        let function = self.c.this_container(file, this)?.ok()?;
        match self.c.hir(file)[function].kind {
            FnKind::Decl | FnKind::Expr => Some(function),
            FnKind::Arrow
            | FnKind::Method
            | FnKind::Getter
            | FnKind::Setter
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => None,
        }
    }

    fn compute_prototype_links(&mut self, file: FileId) -> PrototypeLinks<'s> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let mut collector = LinkCollector::new(self.end_finder(file));
        if bound.runtime.is_computed() {
            let expressions = self.c.exprs_by_kind(file);
            let is_live = |expression: ExprId| {
                bound.parent_of_expr(expression) != Parent::None
                    && !self.c.is_dead_expression(file, expression)
            };
            for &call in expressions.of(ExprTag::Call) {
                if is_live(call) {
                    collector.visit_call(call);
                }
            }
            for &assign in expressions.of(ExprTag::Assign) {
                if let ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } = hir[assign].kind
                    && is_live(assign)
                {
                    collector.visit_store(target, value);
                }
            }
        }
        let LinkCollector {
            links,
            calls,
            mut calls_passing_parameters,
            calls_passing_this,
            mut copied_literals,
            ..
        } = collector;
        let mut links_of_declarations = Vec::new();
        let mut links_of_parameters = Vec::new();
        for link in links {
            match link.child {
                LinkEnd::Declaration(_) => links_of_declarations.push(link),
                // The program changes a prototype object of the library, which says nothing of its own classes.
                LinkEnd::LibraryDeclaration(_) => {}
                LinkEnd::Parameter { function, .. } => links_of_parameters.push((function, link)),
            }
        }
        let find_caller = |passing: CallPassingThis| {
            let caller = self.find_function_of_this(file, passing.this)?;
            Some((caller, passing.call))
        };
        let mut calls_passing_this: Vec<(FnId, FunctionCall)> =
            calls_passing_this.into_iter().filter_map(find_caller).collect();
        links_of_parameters.sort_by_key(|entry| entry.0);
        calls_passing_parameters.sort_by_key(|entry| entry.0);
        calls_passing_this.sort_by_key(|&(caller, call)| (caller, hir[call.call].pos, call.call));
        copied_literals.sort_by_key(|&(function, literal)| (function, hir[literal].pos, literal));
        let arena = self.c.arena;
        PrototypeLinks {
            links_of_declarations: list_in(arena, &links_of_declarations),
            links_of_parameters: list_in(arena, &links_of_parameters),
            calls: list_in(arena, &calls),
            calls_passing_parameters: list_in(arena, &calls_passing_parameters),
            calls_passing_this: list_in(arena, &calls_passing_this),
            copied_literals: list_in(arena, &copied_literals),
            linked_functions: OnceLock::new(),
            declarations_used_like_constructors: OnceLock::new(),
        }
    }
}
