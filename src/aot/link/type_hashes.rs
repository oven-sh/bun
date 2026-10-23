use super::program_keys::{ProgramFunctionKey, ProgramLayoutKey};
use crate::ir::{
    ClassPart, FunctionId, Id, LayoutId, StringId, StringTable, Type, TypeId, TypeTable,
};
use bun_sema::check::aot::type_identity::Lanes;
use core::hash::{Hash, Hasher};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(super) struct ContentHash(pub [u64; 2]);

pub(super) struct TypeHashes {
    pub types: Vec<ContentHash>,
    pub nesting_depths: Vec<u32>,
}

struct ContentHasher(Lanes);

impl ContentHasher {
    fn new() -> ContentHasher {
        ContentHasher(Lanes::START)
    }

    fn add(&mut self, word: u64) {
        self.0.add(word);
    }

    fn add_words(&mut self, words: impl ExactSizeIterator<Item = u32>) {
        self.add(words.len() as u64);
        for word in words {
            self.add(u64::from(word));
        }
    }

    fn add_optional_word(&mut self, word: Option<u32>) {
        match word {
            None => self.add(0),
            Some(word) => {
                self.add(1);
                self.add(u64::from(word));
            }
        }
    }

    fn add_hash(&mut self, hash: ContentHash) {
        self.add(hash.0[0]);
        self.add(hash.0[1]);
    }

    fn add_optional_hash(&mut self, hash: Option<ContentHash>) {
        match hash {
            None => self.add(0),
            Some(hash) => {
                self.add(1);
                self.add_hash(hash);
            }
        }
    }

    fn add_hashes(&mut self, hashes: impl ExactSizeIterator<Item = ContentHash>) {
        self.add(hashes.len() as u64);
        for hash in hashes {
            self.add_hash(hash);
        }
    }

    fn add_hash_set(&mut self, hashes: &mut [ContentHash]) {
        hashes.sort_unstable();
        self.add_hashes(hashes.iter().copied());
    }

    fn content_hash(&self) -> ContentHash {
        ContentHash(self.0.0)
    }
}

type ElementHashes = SmallVec<[ContentHash; 4]>;

struct TypeHasher<'a> {
    strings: &'a StringTable,
    layout_keys: &'a [ProgramLayoutKey],
    function_keys: &'a [ProgramFunctionKey],
    string_hashes: Vec<Option<ContentHash>>,
    layout_hashes: Vec<Option<ContentHash>>,
    type_hashes: Vec<ContentHash>,
    nesting_depths: Vec<u32>,
}

impl TypeHasher<'_> {
    fn hash_string(&mut self, id: StringId) -> ContentHash {
        let strings = self.strings;
        *self.string_hashes[id.index()].get_or_insert_with(|| {
            let mut hasher = ContentHasher::new();
            hasher.0.write(strings.get(id));
            hasher.content_hash()
        })
    }

    fn hash_layout(&mut self, id: LayoutId) -> ContentHash {
        let key = self.layout_keys[id.index()];
        *self.layout_hashes[id.index()].get_or_insert_with(|| {
            let mut hasher = ContentHasher::new();
            key.hash(&mut hasher.0);
            hasher.content_hash()
        })
    }

    fn hash_function(&self, id: FunctionId) -> ContentHash {
        let mut hasher = ContentHasher::new();
        self.function_keys[id.index()].hash(&mut hasher.0);
        hasher.content_hash()
    }

    fn child_hash(&self, id: TypeId) -> ContentHash {
        self.type_hashes[id.index()]
    }

    fn nesting_depth(&self, ty: &Type) -> u32 {
        let contents = ty.classes.iter().flat_map(|part| &part.contents);
        let depths = contents.map(|&id| self.nesting_depths[id.index()] + 1);
        depths.max().unwrap_or(0)
    }

    fn hash_class_part(&self, part: &ClassPart) -> ContentHash {
        let ClassPart {
            builtin_class,
            contents,
        } = part;
        let mut hasher = ContentHasher::new();
        hasher.add(u64::from(builtin_class.to_wire()));
        hasher.add_hashes(contents.iter().map(|&id| self.child_hash(id)));
        hasher.content_hash()
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
        let mut hasher = ContentHasher::new();
        hasher.add(u64::from(primitives.to_wire()));
        hasher.add(u64::from(flags.to_wire()));
        hasher.add_optional_word(opaque.map(|kind| kind.to_wire()));
        hasher.add_optional_hash(environment.map(|layout| self.hash_layout(layout)));
        hasher.add(*minimum as u64);
        hasher.add(*maximum as u64);
        let mut strings: ElementHashes = strings.iter().map(|&id| self.hash_string(id)).collect();
        hasher.add_hash_set(&mut strings);
        let mut layouts: ElementHashes = layouts.iter().map(|&id| self.hash_layout(id)).collect();
        hasher.add_hash_set(&mut layouts);
        let parts = classes.iter();
        let mut classes: ElementHashes = parts.map(|part| self.hash_class_part(part)).collect();
        hasher.add_hash_set(&mut classes);
        hasher.add_words(builtins.iter().map(|builtin| builtin.to_wire()));
        let mut functions: ElementHashes =
            functions.iter().map(|&id| self.hash_function(id)).collect();
        hasher.add_hash_set(&mut functions);
        hasher.content_hash()
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
        type_hashes: Vec::with_capacity(types.len()),
        nesting_depths: Vec::with_capacity(types.len()),
    };
    for ty in types.iter() {
        let hash = hasher.hash_type(ty);
        hasher.type_hashes.push(hash);
        let depth = hasher.nesting_depth(ty);
        hasher.nesting_depths.push(depth);
    }
    TypeHashes {
        types: hasher.type_hashes,
        nesting_depths: hasher.nesting_depths,
    }
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

    fn layout_set(layouts: [LayoutId; 2]) -> Type {
        Type {
            layouts: layouts.to_vec(),
            ..Type::default()
        }
    }

    fn literal_set(strings: [StringId; 2]) -> Type {
        Type {
            strings: strings.to_vec(),
            ..Type::default()
        }
    }

    fn function_set(functions: [FunctionId; 2]) -> Type {
        Type {
            functions: functions.to_vec(),
            ..Type::default()
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

    #[test]
    fn layout_set_hash_ignores_declaration_order() {
        let hash_layout_set = |keys: [LayoutKey; 2]| {
            hash_type(|builder| layout_set(keys.map(|key| builder.declare_layout(key))))
        };
        let hash = hash_layout_set([dog_key(), animal_key()]);
        assert_eq!(hash_layout_set([animal_key(), dog_key()]), hash);
        assert_ne!(hash_layout_set([dog_key(), environment_key()]), hash);
    }

    #[test]
    fn layout_hash_includes_project() {
        let mut builder = FragmentBuilder::new(FileId(0));
        let layout = builder.declare_layout(dog_key());
        let id = builder.types.intern(Type::layout(layout));
        let [application, runtime] =
            ProjectId::ALL.map(|project| hash_declared_types(&builder, project).types[id.index()]);
        assert_ne!(application, runtime);
    }

    #[test]
    fn function_set_hash_ignores_declaration_order() {
        let hash_function_set = |keys: [FunctionKey; 2]| {
            hash_type(|builder| function_set(keys.map(|key| builder.declare_function(key))))
        };
        let [first, second, third] = [0, 1, 2].map(|function| test_function_key(9, function));
        let hash = hash_function_set([first, second]);
        assert_eq!(hash_function_set([second, first]), hash);
        assert_ne!(hash_function_set([first, third]), hash);
    }

    #[test]
    fn function_hash_includes_project() {
        let mut builder = FragmentBuilder::new(FileId(0));
        let function = builder.declare_function(test_function_key(9, 0));
        let id = builder.types.intern(Type::function(function));
        let [application, runtime] =
            ProjectId::ALL.map(|project| hash_declared_types(&builder, project).types[id.index()]);
        assert_ne!(application, runtime);
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
    fn literal_set_hash_ignores_intern_order() {
        let hash_literal_set = |texts: [&[u8]; 2]| {
            hash_type(|builder| literal_set(texts.map(|text| builder.strings.intern(text))))
        };
        let hash = hash_literal_set([b"x", b"y"]);
        assert_eq!(hash_literal_set([b"y", b"x"]), hash);
        assert_ne!(hash_literal_set([b"x", b"z"]), hash);
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
