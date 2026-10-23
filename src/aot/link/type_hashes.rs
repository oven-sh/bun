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
