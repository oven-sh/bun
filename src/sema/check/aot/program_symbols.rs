use crate::bind::{Decl, SymFlags};
use crate::check::{Checker, Program};
use crate::hir::{TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Files, Sym};
use crate::types::{SigData, SigId};
use smallvec::SmallVec;

pub const COMPILER_DECLARATIONS_PATH: &[u8] = b"/$bun/types/compiler.d.ts";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(super) enum SchemaAlias {
    Int,
    Min,
    Max,
    Above,
    Below,
    MultipleOf,
    MinLength,
    MaxLength,
    MinItems,
    MaxItems,
    Pattern,
    Format,
    Message,
    Default,
    Strict,
    DeepStrict,
    UniqueItems,
    Contains,
    Not,
    If,
    OneOf,
    AllOf,
    PatternProperties,
    PropertyNames,
    MinProperties,
    MaxProperties,
    DependentRequired,
    DependentSchemas,
    Refused,
}

impl SchemaAlias {
    pub(super) const COUNT: usize = 29;
    pub(super) const ALL: [SchemaAlias; SchemaAlias::COUNT] = [
        SchemaAlias::Int,
        SchemaAlias::Min,
        SchemaAlias::Max,
        SchemaAlias::Above,
        SchemaAlias::Below,
        SchemaAlias::MultipleOf,
        SchemaAlias::MinLength,
        SchemaAlias::MaxLength,
        SchemaAlias::MinItems,
        SchemaAlias::MaxItems,
        SchemaAlias::Pattern,
        SchemaAlias::Format,
        SchemaAlias::Message,
        SchemaAlias::Default,
        SchemaAlias::Strict,
        SchemaAlias::DeepStrict,
        SchemaAlias::UniqueItems,
        SchemaAlias::Contains,
        SchemaAlias::Not,
        SchemaAlias::If,
        SchemaAlias::OneOf,
        SchemaAlias::AllOf,
        SchemaAlias::PatternProperties,
        SchemaAlias::PropertyNames,
        SchemaAlias::MinProperties,
        SchemaAlias::MaxProperties,
        SchemaAlias::DependentRequired,
        SchemaAlias::DependentSchemas,
        SchemaAlias::Refused,
    ];
    pub(super) const NAMES: [&'static [u8]; SchemaAlias::COUNT] = [
        b"Int",
        b"Min",
        b"Max",
        b"Above",
        b"Below",
        b"MultipleOf",
        b"MinLength",
        b"MaxLength",
        b"MinItems",
        b"MaxItems",
        b"Pattern",
        b"Format",
        b"Message",
        b"Default",
        b"Strict",
        b"DeepStrict",
        b"UniqueItems",
        b"Contains",
        b"Not",
        b"If",
        b"OneOf",
        b"AllOf",
        b"PatternProperties",
        b"PropertyNames",
        b"MinProperties",
        b"MaxProperties",
        b"DependentRequired",
        b"DependentSchemas",
        b"Refused",
    ];

    pub(super) fn name(self) -> &'static [u8] {
        SchemaAlias::NAMES[self as usize]
    }
}

/// The key of the one member of the type literal of `int32` and of each alias of `Schema`. `Strict` and `DeepStrict` share theirs.
pub const BRAND_KEYS: [&[u8]; SchemaAlias::COUNT] = [
    b"bun.int32",
    b"bun.int",
    b"bun.min",
    b"bun.max",
    b"bun.above",
    b"bun.below",
    b"bun.multipleOf",
    b"bun.minLength",
    b"bun.maxLength",
    b"bun.minItems",
    b"bun.maxItems",
    b"bun.pattern",
    b"bun.format",
    b"bun.message",
    b"bun.default",
    b"bun.strict",
    b"bun.uniqueItems",
    b"bun.contains",
    b"bun.not",
    b"bun.if",
    b"bun.oneOf",
    b"bun.allOf",
    b"bun.patternProperties",
    b"bun.propertyNames",
    b"bun.minProperties",
    b"bun.maxProperties",
    b"bun.dependentRequired",
    b"bun.dependentSchemas",
    b"bun.refused",
];

pub(super) fn is_brand_key(name: &[u8]) -> bool {
    BRAND_KEYS.contains(&name)
}

pub(in crate::check) struct ProgramSymbols {
    compiler_declarations: Option<FileId>,
    int32: Option<Sym>,
    int32_tag: Option<(FileId, TypeNodeId)>,
    schema_aliases: [Option<Sym>; SchemaAlias::COUNT],
    from_json_schema: Option<Sym>,
}

impl ProgramSymbols {
    fn resolve(files: &Files<'_>) -> ProgramSymbols {
        let declared_in = files.by_path.get(COMPILER_DECLARATIONS_PATH);
        let mut symbols = ProgramSymbols {
            compiler_declarations: declared_in,
            int32: None,
            int32_tag: None,
            schema_aliases: [None; SchemaAlias::COUNT],
            from_json_schema: None,
        };
        let bun_module = files
            .atoms
            .lookup(b"bun")
            .and_then(|name| files.try_find_ambient_module(name));
        let Some(bun_module) = bun_module else {
            return symbols;
        };
        symbols.int32 = find_type_alias(files, bun_module, b"int32", declared_in);
        symbols.int32_tag = symbols
            .int32
            .and_then(|int32| find_tag_literal(files, int32));
        let schema = find_export(files, bun_module, b"Schema", declared_in)
            .filter(|&schema| files.flags(schema).intersects(SymFlags::NAMESPACE));
        if let Some(schema) = schema {
            for (alias, name) in symbols.schema_aliases.iter_mut().zip(SchemaAlias::NAMES) {
                *alias = find_type_alias(files, schema, name, declared_in);
            }
            symbols.from_json_schema =
                find_type_alias(files, schema, b"FromJSONSchema", declared_in);
        }
        symbols
    }

    pub(super) fn int32_alias(&self) -> Option<Sym> {
        self.int32
    }

    pub(super) fn from_json_schema(&self) -> Option<Sym> {
        self.from_json_schema
    }

    pub(super) fn is_compiler_known_alias(&self, alias: Sym) -> bool {
        self.int32 == Some(alias) || self.schema_aliases.contains(&Some(alias))
    }

    pub(super) fn is_int32_tag(&self, file: FileId, literal: TypeNodeId) -> bool {
        self.int32_tag == Some((file, literal))
    }

    pub(super) fn schema_alias(&self, alias: Sym) -> Option<SchemaAlias> {
        let index = self
            .schema_aliases
            .iter()
            .position(|&known| known == Some(alias))?;
        Some(SchemaAlias::ALL[index])
    }
}

fn find_export(
    files: &Files<'_>,
    container: Sym,
    name: &[u8],
    declared_in: Option<FileId>,
) -> Option<Sym> {
    let name = files.atoms.lookup(name)?;
    let Some(file) = declared_in else {
        return files.export(container, name);
    };
    let parts = files.parts(container);
    let part = parts.iter().find(|part| part.file == file)?;
    let bound = files.bound(file);
    let id = bound.lookup(bound.symbol(part.id).exports, name)?;
    Some(Sym { file, id })
}

fn find_type_alias(
    files: &Files<'_>,
    container: Sym,
    name: &[u8],
    declared_in: Option<FileId>,
) -> Option<Sym> {
    let alias = find_export(files, container, name, declared_in)?;
    files
        .flags(alias)
        .contains(SymFlags::TYPE_ALIAS)
        .then(|| files.canonical(alias))
}

fn find_tag_literal(files: &Files<'_>, int32: Sym) -> Option<(FileId, TypeNodeId)> {
    let declarations = files.decls_of(int32);
    let (file, alias) = declarations.iter().find_map(|&(file, decl)| match decl {
        Decl::Alias(alias) => Some((file, alias)),
        _ => None,
    })?;
    let hir = files.hir(file);
    let TypeNodeKind::Intersection(parts) = hir[hir[alias].ty].kind else {
        return None;
    };
    let mut literals = hir
        .ids(parts)
        .filter(|&part| matches!(hir[part].kind, TypeNodeKind::Object(_)));
    let literal = literals.next()?;
    literals.next().is_none().then_some((file, literal))
}

impl Checker<'_, '_> {
    pub(in crate::check) fn remove_compiler_signatures(
        &self,
        signatures: &mut SmallVec<[SigId; 4]>,
    ) {
        let Some(compiler_declarations) = self.p.aot_symbols().compiler_declarations else {
            return;
        };
        let is_of_program = |&signature: &SigId| {
            let declaration = self.types().sig(signature);
            !matches!(*declaration, SigData::Decl { file, .. } if file == compiler_declarations)
        };
        if signatures.iter().any(is_of_program) {
            signatures.retain(|signature| is_of_program(signature));
        }
    }
}

impl<'s> Program<'s> {
    pub(in crate::check) fn aot_symbols(&self) -> &ProgramSymbols {
        self.aot_symbols
            .get_or_init(|| ProgramSymbols::resolve(self.files))
    }
}

#[cfg(test)]
mod tests {
    use super::{BRAND_KEYS, SchemaAlias, is_brand_key};

    #[test]
    fn names_match_variants() {
        assert_eq!(SchemaAlias::ALL.len(), SchemaAlias::COUNT);
        for (index, (alias, name)) in SchemaAlias::ALL.iter().zip(SchemaAlias::NAMES).enumerate() {
            assert_eq!(*alias as usize, index);
            assert_eq!(format!("{alias:?}").as_bytes(), name);
        }
    }

    #[test]
    fn every_alias_has_its_brand_key() {
        for alias in SchemaAlias::ALL {
            let name = match alias == SchemaAlias::DeepStrict {
                true => SchemaAlias::Strict.name(),
                false => alias.name(),
            };
            let mut key = b"bun.".to_vec();
            key.push(name[0].to_ascii_lowercase());
            key.extend_from_slice(&name[1..]);
            assert!(is_brand_key(&key), "{alias:?}");
        }
        assert!(is_brand_key(b"bun.int32"));
    }

    #[test]
    fn no_brand_key_is_listed_twice() {
        let mut keys = BRAND_KEYS.to_vec();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), BRAND_KEYS.len());
    }

    #[test]
    fn a_brand_key_is_known_by_its_whole_name() {
        let others: [&[u8]; 6] = [
            b"bun.",
            b"bun.deepStrict",
            b"bun.Strict",
            b"bun.strict ",
            b"bun.minimum",
            b"strict",
        ];
        for other in others {
            assert!(!is_brand_key(other));
        }
    }
}
