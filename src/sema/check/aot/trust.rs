use super::answers::ClassRef;
use super::queries::Queries;
use crate::bind::Decl;
use crate::hir::Flags;
use crate::program::{FileId, FileRole, Sym};
use crate::types::{Origin, Prop, PropSource, TypeData, TypeId};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
#[repr(u8)]
pub enum Trust {
    #[default]
    Untrusted,
    Trusted,
}

impl Trust {
    pub fn of_role(role: FileRole) -> Trust {
        match role {
            FileRole::Checked => Trust::Trusted,
            FileRole::Inferred | FileRole::TypesOnly => Trust::Untrusted,
        }
    }

    pub fn is_trusted(self) -> bool {
        match self {
            Trust::Trusted => true,
            Trust::Untrusted => false,
        }
    }

    pub fn strongest(self, other: Trust) -> Trust {
        self.max(other)
    }

    pub fn weakest(self, other: Trust) -> Trust {
        self.min(other)
    }
}

type VisitedTypes = SmallVec<[TypeId; 4]>;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub fn file_trust(&self, file: FileId) -> Trust {
        if self.files().module(file).runs_other_code {
            return Trust::Untrusted;
        }
        match self.inputs.checked_elsewhere.binary_search(&file) {
            Ok(_) => Trust::Untrusted,
            Err(_) => Trust::of_role(self.role(file)),
        }
    }

    pub fn symbol_trust(&self, symbol: Sym) -> Trust {
        let declarations = self.files().decls_of(symbol);
        let trusts = declarations.iter().map(|&(file, _)| self.file_trust(file));
        trusts.fold(Trust::Untrusted, Trust::strongest)
    }

    pub fn compiled_class(&self, symbol: Sym) -> Option<ClassRef> {
        let declarations = self.files().decls_of(symbol);
        let mut classes = declarations.iter().filter_map(|&(file, decl)| {
            if let Decl::Class(class) = decl {
                Some(ClassRef { file, class })
            } else {
                None
            }
        });
        let class = classes.next()?;
        let is_single = classes.next().is_none();
        let is_ambient = self.c.hir(class.file)[class.class]
            .flags
            .contains(Flags::AMBIENT);
        (is_single && self.c.is_compiled_file(class.file) && !is_ambient).then_some(class)
    }

    pub(super) fn member_trust(&self, declarations: &[(FileId, Decl)]) -> Trust {
        self.weakest_file_trust(declarations.iter().map(|&(file, _)| file))
    }

    fn weakest_file_trust(&self, files: impl Iterator<Item = FileId>) -> Trust {
        let trusts = files.map(|file| self.file_trust(file));
        trusts.reduce(Trust::weakest).unwrap_or(Trust::Untrusted)
    }

    pub(super) fn is_type_function_file(&self, file: FileId) -> bool {
        self.file_trust(file).is_trusted() || self.files().module(file).is_lib
    }

    pub(super) fn is_transparent_alias(&self, alias: Sym) -> bool {
        self.c.p.aot_symbols().int32_alias() == Some(alias)
            || self.is_declared_in_type_function_files(alias)
    }

    pub(super) fn is_declared_in_type_function_files(&self, symbol: Sym) -> bool {
        let declarations = self.files().decls_of(symbol);
        !declarations.is_empty()
            && declarations
                .iter()
                .all(|&(file, _)| self.is_type_function_file(file))
    }

    pub(super) fn object_type_trust(&mut self, ty: TypeId) -> Trust {
        self.object_type_trust_within(ty, &mut VisitedTypes::new())
    }

    fn object_type_trust_within(&mut self, ty: TypeId, visited: &mut VisitedTypes) -> Trust {
        if visited.contains(&ty) || self.c.is_stack_low() {
            return Trust::Untrusted;
        }
        visited.push(ty);
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => self.symbol_trust(*target),
            TypeData::Anon { origin, .. } => self.origin_trust(ty, *origin, visited),
            TypeData::Fns { decls, .. } => {
                self.weakest_file_trust(decls.iter().map(|&(file, _)| file))
            }
            TypeData::Intersection(parts) => {
                let mut trust = Trust::Untrusted;
                for &part in parts.iter() {
                    trust = trust.strongest(self.object_type_trust_within(part, visited));
                }
                trust
            }
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } => self.members_trust(ty),
            _ => Trust::Untrusted,
        }
    }

    fn origin_trust(&mut self, ty: TypeId, origin: Origin, visited: &mut VisitedTypes) -> Trust {
        match origin {
            Origin::TypeLiteral(file, _)
            | Origin::ObjectLiteral(file, ..)
            | Origin::WidenedLiteral(file, ..) => self.file_trust(file),
            Origin::Mapped(file, _) => match self.c.mapped_modifiers_type(ty) {
                Some(modifiers_type) => self.object_type_trust_within(modifiers_type, visited),
                None if self.is_type_function_file(file) => Trust::Trusted,
                None => Trust::Untrusted,
            },
            Origin::ClassStatic(symbol)
            | Origin::Function(symbol)
            | Origin::EnumObject(symbol)
            | Origin::Module(symbol)
            | Origin::Namespace { module: symbol, .. } => self.symbol_trust(symbol),
            Origin::GlobalThis => Trust::Untrusted,
        }
    }

    fn members_trust(&mut self, ty: TypeId) -> Trust {
        let Some(members) = self.c.members(ty) else {
            return Trust::Untrusted;
        };
        let shape = members.shape();
        if !shape.props.is_empty() {
            return self.strongest_prop_trust(&shape.props);
        }
        let signatures = shape.call.iter().chain(shape.construct.iter());
        let files: Option<SmallVec<[FileId; 2]>> = signatures
            .map(|&signature| self.c.sig_decl(signature).map(|declaration| declaration.0))
            .collect();
        files.map_or(Trust::Untrusted, |files| {
            self.weakest_file_trust(files.into_iter())
        })
    }

    fn strongest_prop_trust(&mut self, props: &'p [Prop<'p>]) -> Trust {
        let mut trust = Trust::Untrusted;
        for prop in props {
            trust = trust.strongest(self.prop_trust(prop));
            if trust.is_trusted() {
                break;
            }
        }
        trust
    }

    pub(super) fn prop_trust(&mut self, prop: &'p Prop<'p>) -> Trust {
        if self.c.is_stack_low() {
            return Trust::Untrusted;
        }
        let sources: &'p [Prop<'p>] = match &prop.source {
            PropSource::Symbol(symbol) => {
                let declarations = self.c.declarations_of_property(*symbol);
                return self.member_trust(&declarations);
            }
            PropSource::Literal(file, _) => return self.file_trust(*file),
            PropSource::Type(_) => return Trust::Untrusted,
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts) => parts,
            PropSource::Mapped(..) => prop.declared_by_modifiers_property(),
        };
        self.strongest_prop_trust(sources)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_untrusted() {
        assert_eq!(Trust::default(), Trust::Untrusted);
        assert_eq!(Trust::Untrusted as u8, 0);
    }

    #[test]
    fn only_checked_files_are_trusted() {
        assert_eq!(Trust::of_role(FileRole::Checked), Trust::Trusted);
        assert_eq!(Trust::of_role(FileRole::Inferred), Trust::Untrusted);
        assert_eq!(Trust::of_role(FileRole::TypesOnly), Trust::Untrusted);
    }

    #[test]
    fn strongest_and_weakest() {
        assert_eq!(Trust::Trusted.strongest(Trust::Untrusted), Trust::Trusted);
        assert_eq!(Trust::Trusted.weakest(Trust::Untrusted), Trust::Untrusted);
        assert_eq!(
            Trust::Untrusted.strongest(Trust::Untrusted),
            Trust::Untrusted
        );
        assert_eq!(Trust::Trusted.weakest(Trust::Trusted), Trust::Trusted);
    }
}
