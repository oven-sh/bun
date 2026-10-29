use crate::check::aot::queries::Queries;
use crate::hir::{TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Sym};
use crate::types::{TypeData, TypeId};
use crate::util::FxHashSet;
use smallvec::SmallVec;

const MAX_CONSTRAINT_STEPS: usize = 8;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    /// The checker finds the base constraint of a conditional type by evaluating it with the constraints of its type parameters.
    pub(super) fn has_costly_base_constraint(&mut self, ty: TypeId) -> bool {
        let mut pending: SmallVec<[TypeId; 4]> = SmallVec::from_slice(&[ty]);
        let mut steps = 0;
        while let Some(part) = pending.pop() {
            steps += 1;
            if steps > MAX_CONSTRAINT_STEPS {
                return true;
            }
            match *self.c.data(part) {
                TypeData::Cond { file, node, .. } => {
                    if self.is_recursive_conditional(file, node) {
                        return true;
                    }
                }
                TypeData::IndexedAccess { obj, index, .. } => pending.extend([obj, index]),
                TypeData::Keyof(operand) => pending.push(operand),
                TypeData::Substitution { base, .. } => pending.push(base),
                TypeData::TypeParam(..) => pending.extend(self.c.constraint_of_type_param(part)),
                _ => {}
            }
        }
        false
    }

    /// Whether evaluating the conditional type at `node` can come back to `node` through the type aliases that it names.
    fn is_recursive_conditional(&mut self, file: FileId, node: TypeNodeId) -> bool {
        if let Some(&known) = self.kept.recursive_conditionals.get(&(file, node)) {
            return known;
        }
        let is_recursive = self.reaches_itself(file, node);
        self.kept
            .recursive_conditionals
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
        } = self.c.hir(file)[node].kind
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
            let hir = self.c.hir(part_file);
            let mut push = |nodes: &mut dyn Iterator<Item = TypeNodeId>| {
                pending.extend(nodes.filter(|it| it.is_some()).map(|it| (part_file, it)));
            };
            let named = match hir[part].kind {
                TypeNodeKind::Ref { name, args } => {
                    push(&mut hir.ids(args));
                    self.find_referenced_symbol(part_file, part, name)
                }
                TypeNodeKind::Import {
                    args,
                    is_typeof: false,
                    ..
                } => {
                    push(&mut hir.ids(args));
                    self.find_imported_symbol(part_file, part)
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
            let named = self.c.files().canonical(named);
            if let Some((alias_file, alias)) = self.find_type_alias(named)
                && entered.insert(named)
            {
                pending.push((alias_file, alias.ty));
            }
        }
        false
    }
}
