use super::program_keys::{ProgramFunctionKey, ProgramLayoutKey};
use crate::ir::{ClassPart, FunctionId, Id, LayoutId, StringId, StringTable, Type, TypeTable};
use bun_sema::check::aot::type_identity::Lanes;
use core::hash::{Hash, Hasher};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(super) struct ContentHash(pub [u64; 2]);

impl From<ContentHash> for u64 {
    fn from(hash: ContentHash) -> u64 {
        hash.0[0]
    }
}

pub(super) struct TypeHashes {
    pub types: Vec<ContentHash>,
    pub nesting_depths: Vec<u32>,
}

struct ContentHasher(Lanes);

impl ContentHasher {
    fn hash_with(feed: impl FnOnce(&mut ContentHasher)) -> ContentHash {
        let mut hasher = ContentHasher(Lanes::START);
        feed(&mut hasher);
        ContentHash(hasher.0.0)
    }

    fn add(&mut self, word: u64) {
        self.0.add(word);
    }

    // An optional item is a list of at most one.
    fn add_list<const N: usize>(&mut self, items: impl ExactSizeIterator<Item = [u64; N]>) {
        self.add(items.len() as u64);
        for word in items.flatten() {
            self.add(word);
        }
    }

    fn add_hash_set(&mut self, hashes: impl Iterator<Item = ContentHash>) {
        let mut hashes: SmallVec<[ContentHash; 4]> = hashes.collect();
        hashes.sort_unstable();
        self.add_list(hashes.iter().map(|hash| hash.0));
    }
}

struct TypeHasher<'a> {
    strings: &'a StringTable,
    layout_keys: &'a [ProgramLayoutKey],
    function_keys: &'a [ProgramFunctionKey],
    string_hashes: Vec<Option<ContentHash>>,
    layout_hashes: Vec<Option<ContentHash>>,
    hashes: TypeHashes,
}

impl TypeHasher<'_> {
    fn hash_string(&mut self, id: StringId) -> ContentHash {
        let strings = self.strings;
        *self.string_hashes[id.index()].get_or_insert_with(|| {
            ContentHasher::hash_with(|hasher| hasher.0.write(strings.get(id)))
        })
    }

    fn hash_layout(&mut self, id: LayoutId) -> ContentHash {
        let key = self.layout_keys[id.index()];
        *self.layout_hashes[id.index()]
            .get_or_insert_with(|| ContentHasher::hash_with(|hasher| key.hash(&mut hasher.0)))
    }

    fn hash_function(&self, id: FunctionId) -> ContentHash {
        ContentHasher::hash_with(|hasher| self.function_keys[id.index()].hash(&mut hasher.0))
    }

    fn nesting_depth(&self, ty: &Type) -> u32 {
        let contents = ty.classes.iter().flat_map(|part| &part.contents);
        let depths = contents.map(|&id| self.hashes.nesting_depths[id.index()] + 1);
        depths.max().unwrap_or(0)
    }

    fn hash_class_part(&self, part: &ClassPart) -> ContentHash {
        let ClassPart {
            builtin_class,
            contents,
        } = part;
        ContentHasher::hash_with(|hasher| {
            hasher.add(u64::from(builtin_class.to_wire()));
            hasher.add_list(contents.iter().map(|&id| self.hashes.types[id.index()].0));
        })
    }

    fn hash_type(&mut self, ty: &Type) -> ContentHash {
        let Type {
            primitives,
            flags,
            opaque,
            environment,
            minimum,
            maximum,
            strings,
            layouts,
            classes,
            builtins,
            functions,
        } = ty;
        ContentHasher::hash_with(|hasher| {
            hasher.add(u64::from(primitives.to_wire()));
            hasher.add(u64::from(flags.to_wire()));
            hasher.add_list(opaque.iter().map(|kind| [u64::from(kind.to_wire())]));
            hasher.add_list(environment.iter().map(|&layout| self.hash_layout(layout).0));
            hasher.add(*minimum as u64);
            hasher.add(*maximum as u64);
            hasher.add_hash_set(strings.iter().map(|&id| self.hash_string(id)));
            hasher.add_hash_set(layouts.iter().map(|&id| self.hash_layout(id)));
            hasher.add_hash_set(classes.iter().map(|part| self.hash_class_part(part)));
            hasher.add_list(
                builtins
                    .iter()
                    .map(|builtin| [u64::from(builtin.to_wire())]),
            );
            hasher.add_hash_set(functions.iter().map(|&id| self.hash_function(id)));
        })
    }
}

pub(super) fn hash_types(
    types: &TypeTable,
    strings: &StringTable,
    layout_keys: &[ProgramLayoutKey],
    function_keys: &[ProgramFunctionKey],
) -> TypeHashes {
    let mut hasher = TypeHasher {
        strings,
        layout_keys,
        function_keys,
        string_hashes: vec![None; strings.len()],
        layout_hashes: vec![None; layout_keys.len()],
        hashes: TypeHashes {
            types: Vec::with_capacity(types.len()),
            nesting_depths: Vec::with_capacity(types.len()),
        },
    };
    for ty in types.iter() {
        let hash = hasher.hash_type(ty);
        hasher.hashes.types.push(hash);
        let depth = hasher.nesting_depth(ty);
        hasher.hashes.nesting_depths.push(depth);
    }
    hasher.hashes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::id::{BuiltinClass, BuiltinId};
    use crate::ir::{FunctionKey, LayoutKey, OpaqueKind, Primitives};
    use crate::link::InProject;
    use crate::link::testing::{test_class_key, test_function_key};
    use crate::load::ProjectId;
    use crate::lower::FragmentBuilder;
    use bun_sema::check::aot::{ClassRef, FunctionRef};
    use bun_sema::hir::{ClassId, FnId};
    use bun_sema::program::FileId;

    fn dog_key() -> LayoutKey {
        test_class_key(9, 0)
    }

    fn animal_key() -> LayoutKey {
        test_class_key(9, 1)
    }

    fn environment_key() -> LayoutKey {
        LayoutKey::Environment {
            file: FileId(9),
            environment: 0,
        }
    }

    fn hash_declared_types(builder: &FragmentBuilder, project: ProjectId) -> TypeHashes {
        let layout_keys = builder.layout_keys().iter();
        let layout_keys: Vec<ProgramLayoutKey> =
            layout_keys.map(|&key| InProject { project, key }).collect();
        let function_keys = builder.function_keys().iter();
        let function_keys: Vec<ProgramFunctionKey> = function_keys
            .map(|&key| InProject { project, key })
            .collect();
        hash_types(
            &builder.types,
            &builder.strings,
            &layout_keys,
            &function_keys,
        )
    }

    fn hash_type(create_type: impl FnOnce(&mut FragmentBuilder) -> Type) -> ContentHash {
        let mut builder = FragmentBuilder::new(FileId(0));
        let ty = create_type(&mut builder);
        let id = builder.types.intern(ty);
        hash_declared_types(&builder, ProjectId::Application).types[id.index()]
    }

    fn assert_hash_ignores_order<E: Copy>(
        [first, second, third]: [E; 3],
        hash_set: impl Fn([E; 2]) -> ContentHash,
    ) {
        let hash = hash_set([first, second]);
        assert_eq!(hash_set([second, first]), hash);
        assert_ne!(hash_set([first, third]), hash);
    }

    #[test]
    fn set_hash_ignores_order_of_members() {
        assert_hash_ignores_order([dog_key(), animal_key(), environment_key()], |keys| {
            hash_type(|builder| Type {
                layouts: keys.map(|key| builder.declare_layout(key)).to_vec(),
                ..Type::default()
            })
        });
        let functions = [0, 1, 2].map(|function| test_function_key(9, function));
        assert_hash_ignores_order(functions, |keys| {
            hash_type(|builder| Type {
                functions: keys.map(|key| builder.declare_function(key)).to_vec(),
                ..Type::default()
            })
        });
        assert_hash_ignores_order([b"x", b"y", b"z"], |texts| {
            hash_type(|builder| Type {
                strings: texts.map(|text| builder.strings.intern(text)).to_vec(),
                ..Type::default()
            })
        });
    }

    #[test]
    fn layout_and_function_hashes_include_project() {
        let mut builder = FragmentBuilder::new(FileId(0));
        let layout = builder.declare_layout(dog_key());
        let function = builder.declare_function(test_function_key(9, 0));
        for ty in [Type::layout(layout), Type::function(function)] {
            let id = builder.types.intern(ty);
            let [application, runtime] = ProjectId::ALL
                .map(|project| hash_declared_types(&builder, project).types[id.index()]);
            assert_ne!(application, runtime);
        }
    }

    #[test]
    fn function_type_hash_differs_from_definition_hash() {
        let declaration = FunctionRef {
            file: FileId(9),
            function: FnId(0),
        };
        let class = ClassRef {
            file: FileId(9),
            class: ClassId(0),
        };
        let keys = [
            FunctionKey::Source(declaration),
            FunctionKey::Signature(declaration),
            FunctionKey::ImplicitConstructor(class),
            FunctionKey::ClassSignature(class),
        ];
        let hashes =
            keys.map(|key| hash_type(|builder| Type::function(builder.declare_function(key))));
        let mut distinct_hashes = hashes.to_vec();
        distinct_hashes.sort_unstable();
        distinct_hashes.dedup();
        assert_eq!(distinct_hashes.len(), keys.len());
    }

    #[test]
    fn literal_hash_separates_lengths_256_apart() {
        let hash_zeros = |length: usize| {
            hash_type(|builder| Type::string_literal(builder.strings.intern(&vec![0; length])))
        };
        assert_eq!(hash_zeros(256), hash_zeros(256));
        assert_ne!(hash_zeros(0), hash_zeros(256));
        assert_ne!(hash_zeros(3), hash_zeros(259));
    }

    #[test]
    fn class_hash_includes_contents() {
        let hash_array = |element_key: LayoutKey| {
            hash_type(|builder| {
                let layout = builder.declare_layout(element_key);
                let element = builder.types.intern(Type::layout(layout));
                Type::class(BuiltinClass::Array, &[element])
            })
        };
        assert_eq!(hash_array(dog_key()), hash_array(dog_key()));
        assert_ne!(hash_array(dog_key()), hash_array(animal_key()));
    }

    #[test]
    fn environment_hash_differs_from_layout_hash() {
        let key = environment_key();
        let environment = hash_type(|builder| Type::environment(builder.declare_layout(key)));
        let layout = hash_type(|builder| Type::layout(builder.declare_layout(key)));
        assert_ne!(environment, layout);
    }

    #[test]
    fn each_type_field_changes_hash() {
        let mut builder = FragmentBuilder::new(FileId(0));
        let layout = builder.declare_layout(dog_key());
        let function = builder.declare_function(test_function_key(9, 0));
        let text = builder.strings.intern(b"x");
        let types = [
            Type::never(),
            Type::primitives(Primitives::NUMBER),
            Type::any_function(),
            Type::opaque(OpaqueKind::IteratorState),
            Type::opaque(OpaqueKind::Exception),
            Type::environment(layout),
            Type::integers(0, 9),
            Type::integers(-1, 9),
            Type::integers(0, 10),
            Type::string_literal(text),
            Type::layout(layout),
            Type::class(BuiltinClass::Array, &[TypeTable::NUMBER]),
            Type::builtin(BuiltinId::GlobalThis),
            Type::builtin(BuiltinId::AsyncFunction),
            Type::function(function),
        ];
        let ids = types.map(|ty| builder.types.intern(ty));
        let hashes = hash_declared_types(&builder, ProjectId::Application).types;
        let mut distinct_hashes = ids.map(|id| hashes[id.index()]).to_vec();
        distinct_hashes.sort_unstable();
        distinct_hashes.dedup();
        assert_eq!(distinct_hashes.len(), ids.len());
    }
}
