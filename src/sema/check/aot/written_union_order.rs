use super::queries::Queries;
use crate::bind::Decl;
use crate::hir::{IdList, MemberId, MemberKind, Span, TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Where a type is written. Equal places have equal orders.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum WrittenPlace {
    Declaration(Sym),
    Node(FileId, TypeNodeId),
}

/// The order in which the members of the unions below one type node are written. The checker sorts the members of a
/// union, so `A | B` and `B | A` are one type, and the order of its members follows their names.
#[derive(Default, Debug)]
pub struct WrittenUnionOrders {
    members: FxHashMap<TypeId, Box<[TypeId]>>,
    written: Vec<TypeId>,
    first_mentions: FxHashMap<TypeId, u32>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Rank {
    InThisUnion(u32),
    InAnotherUnion(u32),
    Unwritten,
}

impl WrittenUnionOrders {
    /// Whether `ty` is written as a member of a union.
    pub fn is_written(&self, ty: TypeId) -> bool {
        self.first_mentions.contains_key(&ty.plain())
    }

    /// Puts `members`, which stand for members of `union`, in the order in which the types that `written_type` gives
    /// for them are written. A union that nobody wrote as it is (an optional member adds `undefined`) goes by where
    /// its members are first written as members of a union. Members that are written nowhere stay behind the others,
    /// in the order they have.
    pub fn sort_members_by<T>(
        &self,
        union: TypeId,
        members: &mut [T],
        written_type: impl Fn(&T) -> TypeId,
    ) {
        let mut positions: FxHashMap<TypeId, u32> = FxHashMap::default();
        let mut entered: SmallVec<[TypeId; 4]> = SmallVec::new();
        self.add_positions(union.plain(), &mut positions, &mut entered);
        members.sort_by_key(|member| {
            let member = written_type(member).plain();
            if let Some(&position) = positions.get(&member) {
                Rank::InThisUnion(position)
            } else if let Some(&mention) = self.first_mentions.get(&member) {
                Rank::InAnotherUnion(mention)
            } else {
                Rank::Unwritten
            }
        });
    }

    fn add_positions(
        &self,
        ty: TypeId,
        positions: &mut FxHashMap<TypeId, u32>,
        entered: &mut SmallVec<[TypeId; 4]>,
    ) {
        match self.members.get(&ty) {
            Some(members) if !entered.contains(&ty) => {
                entered.push(ty);
                for &member in members {
                    self.add_positions(member, positions, entered);
                }
            }
            Some(_) => {}
            None => {
                let next = positions.len() as u32;
                positions.entry(ty).or_insert(next);
            }
        }
    }

    fn add_union(&mut self, union: TypeId, members: &[TypeId]) {
        if !self.members.contains_key(&union) {
            self.members.insert(union, members.into());
            self.written.push(union);
        }
    }

    fn number_first_mentions(&mut self) {
        let mut mentions: FxHashMap<TypeId, u32> = FxHashMap::default();
        for &union in &self.written {
            self.add_positions(union, &mut mentions, &mut SmallVec::new());
        }
        self.first_mentions = mentions;
    }
}

struct Walk {
    orders: WrittenUnionOrders,
    pending: Vec<(FileId, TypeNodeId, MapperId)>,
    entered: FxHashSet<(Sym, MapperId)>,
    max_declarations: usize,
}

impl Walk {
    fn push(
        &mut self,
        file: FileId,
        nodes: impl DoubleEndedIterator<Item = TypeNodeId>,
        mapper: MapperId,
    ) {
        let written = nodes.rev().filter(|node| node.is_some());
        self.pending
            .extend(written.map(|node| (file, node, mapper)));
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn find_written_place(&mut self, file: FileId, node: TypeNodeId) -> WrittenPlace {
        let named = match self.c.hir(file)[node].kind {
            TypeNodeKind::Ref { name, args } if args.is_empty() => {
                self.find_referenced_symbol(file, node, name)
            }
            _ => None,
        };
        match named {
            Some(symbol) => WrittenPlace::Declaration(self.c.files().canonical(symbol)),
            None => WrittenPlace::Node(file, node),
        }
    }

    /// Follows what a value of the type at `node` is made of: the aliases and interfaces that are named, with their type
    /// arguments, members, elements and the members of unions. Function types hold no data.
    pub(super) fn compute_written_union_orders(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        max_declarations: usize,
    ) -> WrittenUnionOrders {
        let mut walk = Walk {
            orders: WrittenUnionOrders::default(),
            pending: vec![(file, node, MapperId::IDENTITY)],
            entered: FxHashSet::default(),
            max_declarations,
        };
        while let Some((file, node, mapper)) = walk.pending.pop() {
            self.visit_written_node(&mut walk, file, node, mapper);
        }
        self.add_members_of_unwritten_unions(&mut walk.orders);
        walk.orders.number_first_mentions();
        walk.orders
    }

    fn visit_written_node(
        &mut self,
        walk: &mut Walk,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
    ) {
        let hir = self.c.hir(file);
        match hir[node].kind {
            TypeNodeKind::Ref { name, args } => {
                walk.push(file, hir.ids(args), mapper);
                let symbol = self.find_referenced_symbol(file, node, name);
                self.enter_declarations(walk, symbol, file, args, mapper);
            }
            TypeNodeKind::Import {
                args,
                is_typeof: false,
                ..
            } => {
                walk.push(file, hir.ids(args), mapper);
                let symbol = self.find_imported_symbol(file, node);
                self.enter_declarations(walk, symbol, file, args, mapper);
            }
            TypeNodeKind::Array(operand)
            | TypeNodeKind::Readonly(operand)
            | TypeNodeKind::JSDoc { ty: operand, .. }
            | TypeNodeKind::IndexedAccess { obj: operand, .. } => {
                walk.push(file, [operand].into_iter(), mapper);
            }
            TypeNodeKind::Tuple(elements) => {
                walk.push(file, elements.iter().map(|element| hir[element].ty), mapper);
            }
            TypeNodeKind::Union(list) => {
                let union = self.type_written_at(file, node, mapper);
                let members: SmallVec<[TypeId; 8]> = (hir.ids(list))
                    .map(|member| self.type_written_at(file, member, mapper))
                    .collect();
                walk.orders.add_union(union, &members);
                walk.push(file, hir.ids(list), mapper);
            }
            TypeNodeKind::Intersection(list) => walk.push(file, hir.ids(list), mapper),
            TypeNodeKind::Object(members) => push_member_types(walk, hir, file, members, mapper),
            TypeNodeKind::Mapped(mapped) => walk.push(file, [hir[mapped].ty].into_iter(), mapper),
            TypeNodeKind::Cond { yes, no, .. } => walk.push(file, [yes, no].into_iter(), mapper),
            TypeNodeKind::Import {
                is_typeof: true, ..
            }
            | TypeNodeKind::Error
            | TypeNodeKind::Heritage { .. }
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::Template { .. }
            | TypeNodeKind::Fn(_)
            | TypeNodeKind::Infer(_)
            | TypeNodeKind::Keyof(_)
            | TypeNodeKind::UniqueSymbol
            | TypeNodeKind::Unique(_)
            | TypeNodeKind::Typeof { .. }
            | TypeNodeKind::Predicate { .. } => {}
        }
    }

    fn type_written_at(&mut self, file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeId {
        let declared = self.c.type_from_node(file, node);
        self.c.instantiate(declared, mapper).plain()
    }

    fn enter_declarations(
        &mut self,
        walk: &mut Walk,
        symbol: Option<Sym>,
        file: FileId,
        arguments: IdList<TypeNodeId>,
        mapper: MapperId,
    ) {
        let Some(symbol) = symbol else {
            return;
        };
        let symbol = self.c.files().canonical(symbol);
        let parameters = self.c.local_type_params_of_symbol(symbol);
        let arguments = self.c.hir(file).ids(arguments);
        let pairs: SmallVec<[(TypeId, TypeId); 4]> = (parameters.iter().zip(arguments))
            .map(|(&parameter, argument)| {
                let declared = self.c.type_from_node(file, argument);
                (parameter, self.c.instantiate(declared, mapper))
            })
            .collect();
        let inner = self.c.types().mapper_of(&pairs);
        if walk.entered.len() >= walk.max_declarations || !walk.entered.insert((symbol, inner)) {
            return;
        }
        for &(declared_in, declaration) in self.c.files().decls_of(symbol).iter().rev() {
            let hir = self.c.hir(declared_in);
            match declaration {
                Decl::Alias(alias) => walk.push(declared_in, [hir[alias].ty].into_iter(), inner),
                Decl::Interface(interface) => {
                    let interface = hir[interface];
                    push_member_types(walk, hir, declared_in, interface.members, inner);
                    walk.push(declared_in, hir.ids(interface.extends), inner);
                }
                Decl::Var(_)
                | Decl::Param(_)
                | Decl::Fn(_)
                | Decl::Class(_)
                | Decl::Enum(_)
                | Decl::EnumMember(_)
                | Decl::Module(_)
                | Decl::TypeParam(_)
                | Decl::ImportDefault(_)
                | Decl::ImportNamespace(_)
                | Decl::ImportSpec(_)
                | Decl::ImportEquals(_)
                | Decl::ExportSpec(_)
                | Decl::ExportStarAs(_)
                | Decl::ExportExpr(_)
                | Decl::UmdGlobal(_)
                | Decl::File
                | Decl::Require(_)
                | Decl::ModuleExports(_)
                | Decl::ExportsProperty(_)
                | Decl::Expando(_)
                | Decl::ObjectLiteral(_)
                | Decl::CommonJsVariable
                | Decl::Member(_)
                | Decl::ParameterProperty(_)
                | Decl::ThisProperty(_)
                | Decl::Property(_)
                | Decl::TypeLiteral(_) => {}
            }
        }
    }

    /// A member that is a union itself, and that nobody wrote, stands for its members in the checker's order.
    fn add_members_of_unwritten_unions(&mut self, orders: &mut WrittenUnionOrders) {
        let mut unwritten: Vec<TypeId> = Vec::new();
        for members in orders.members.values() {
            let others = members.iter().copied();
            unwritten.extend(others.filter(|member| !orders.members.contains_key(member)));
        }
        for union in unwritten {
            if let TypeData::Union(members) = self.c.data(union) {
                let members: Box<[TypeId]> = members.iter().map(|member| member.plain()).collect();
                orders.members.entry(union).or_insert(members);
            }
        }
    }
}

fn push_member_types(
    walk: &mut Walk,
    hir: &crate::hir::File<'_>,
    file: FileId,
    members: Span<MemberId>,
    mapper: MapperId,
) {
    let holds_data = |member: &MemberId| match hir[*member].kind {
        MemberKind::Property | MemberKind::IndexSignature => true,
        MemberKind::Method
        | MemberKind::Getter
        | MemberKind::Setter
        | MemberKind::Constructor
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::StaticBlock => false,
    };
    let types = members
        .iter()
        .filter(holds_data)
        .map(|member| hir[member].ty);
    walk.push(file, types, mapper);
}
