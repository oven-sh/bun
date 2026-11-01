use crate::bind::{Decl, SymFlags};
use crate::check::Checker;
use crate::hir::{Alias, TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Sym};
use crate::types::{TypeData, TypeId};
use crate::util::FxHashSet;
use smallvec::SmallVec;

const MAX_CONSTRAINT_STEPS: usize = 8;

impl Checker<'_, '_> {
    /// The checker finds the base constraint of a conditional type by evaluating it with the constraints of its type parameters.
    pub(in crate::check) fn has_costly_base_constraint(&mut self, ty: TypeId) -> bool {
        let answered_lowering = std::mem::replace(&mut self.answers_lowering, false);
        let is_costly = self.weigh_base_constraint(ty);
        self.answers_lowering = answered_lowering;
        is_costly
    }

    fn weigh_base_constraint(&mut self, ty: TypeId) -> bool {
        let mut pending: SmallVec<[TypeId; 4]> = SmallVec::from_slice(&[ty]);
        let mut steps = 0;
        while let Some(part) = pending.pop() {
            steps += 1;
            if steps > MAX_CONSTRAINT_STEPS {
                return true;
            }
            match *self.data(part) {
                TypeData::Cond {
                    file, node, mapper, ..
                } => {
                    if self.is_recursive_conditional(file, node) {
                        return true;
                    }
                    let bound = self.types().mapping(mapper).iter();
                    pending.extend(bound.filter(|(from, to)| from != to).map(|&(_, to)| to));
                }
                TypeData::IndexedAccess { obj, index, .. } => pending.extend([obj, index]),
                TypeData::Keyof(operand) => pending.push(operand),
                TypeData::Substitution { base, .. } => pending.push(base),
                TypeData::TypeParam(..) => pending.extend(self.constraint_of_type_param(part)),
                _ => {}
            }
        }
        false
    }

    /// Whether evaluating the conditional type at `node` can come back to `node` through the type aliases that it names.
    fn is_recursive_conditional(&mut self, file: FileId, node: TypeNodeId) -> bool {
        if let Some(&known) = self.recursive_conditionals.get(&(file, node)) {
            return known;
        }
        let is_recursive = self.reaches_itself(file, node);
        self.recursive_conditionals
            .insert((file, node), is_recursive);
        is_recursive
    }

    /// Follows what is evaluated with the type.
    fn reaches_itself(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let TypeNodeKind::Cond {
            check,
            extends,
            yes,
            no,
        } = self.hir(file)[node].kind
        else {
            return false;
        };
        let mut entered: FxHashSet<Sym> = FxHashSet::default();
        let mut pending: Vec<(FileId, TypeNodeId)> = Vec::new();
        pending.extend([check, extends, yes, no].map(|part| (file, part)));
        while let Some((part_file, part)) = pending.pop() {
            if (part_file, part) == (file, node) {
                return true;
            }
            let hir = self.hir(part_file);
            let mut push = |nodes: &mut dyn Iterator<Item = TypeNodeId>| {
                pending.extend(nodes.filter(|it| it.is_some()).map(|it| (part_file, it)));
            };
            let named = match hir[part].kind {
                TypeNodeKind::Ref { name, args } => {
                    push(&mut hir.ids(args));
                    let scope = self.bound(part_file).type_scope[part.idx()];
                    self.resolve_type_reference_name(part_file, scope, name, true)
                }
                TypeNodeKind::Import {
                    args,
                    is_typeof: false,
                    ..
                } => {
                    push(&mut hir.ids(args));
                    let target = self.resolve_import_type(part_file, part, false);
                    target.and_then(|target| self.resolve_symbol(target).symbol())
                }
                TypeNodeKind::Import {
                    args,
                    is_typeof: true,
                    ..
                }
                | TypeNodeKind::Typeof { args, .. } => {
                    push(&mut hir.ids(args));
                    None
                }
                TypeNodeKind::Array(operand)
                | TypeNodeKind::Readonly(operand)
                | TypeNodeKind::Unique(operand)
                | TypeNodeKind::Keyof(operand)
                | TypeNodeKind::JSDoc { ty: operand, .. } => {
                    push(&mut [operand].into_iter());
                    None
                }
                TypeNodeKind::Tuple(elements) => {
                    push(&mut elements.iter().map(|element| hir[element].ty));
                    None
                }
                TypeNodeKind::Union(list)
                | TypeNodeKind::Intersection(list)
                | TypeNodeKind::Template { types: list, .. }
                | TypeNodeKind::Heritage { args: list, .. } => {
                    push(&mut hir.ids(list));
                    None
                }
                TypeNodeKind::Cond {
                    check,
                    extends,
                    yes,
                    no,
                } => {
                    push(&mut [check, extends, yes, no].into_iter());
                    None
                }
                TypeNodeKind::IndexedAccess { obj, index } => {
                    push(&mut [obj, index].into_iter());
                    None
                }
                _ => None,
            };
            let Some(named) = named else {
                continue;
            };
            let named = self.files().canonical(named);
            if let Some((alias_file, alias)) = self.find_only_alias_declaration(named)
                && entered.insert(named)
            {
                pending.push((alias_file, alias.ty));
            }
        }
        false
    }

    fn find_only_alias_declaration(&self, symbol: Sym) -> Option<(FileId, Alias)> {
        let files = self.files();
        if !files.flags(symbol).contains(SymFlags::TYPE_ALIAS) {
            return None;
        }
        let declarations = files.decls_of(symbol);
        let mut aliases = declarations.iter().filter_map(|&(file, decl)| match decl {
            Decl::Alias(alias) => Some((file, alias)),
            _ => None,
        });
        let (Some((file, alias)), None) = (aliases.next(), aliases.next()) else {
            return None;
        };
        Some((file, self.hir(file)[alias]))
    }
}
