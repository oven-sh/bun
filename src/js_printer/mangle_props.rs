//! The naming half of `--mangle-props`: given the `MangledProp` symbols the
//! parser created (merged across files by the linker) and the reserved names,
//! assigns the shortest names to the most used properties, skipping keywords and
//! reserved names. The printer reads the result through `Printer::mangled_prop_name`.

use bun_ast::{Ast, CharFreq, Ref, symbol};
use bun_collections::HashMap;

use crate::MangledProps;
use crate::renamer::StableSymbolCount;

/// Names that must never be handed out as mangled property names. Starts out
/// holding the JavaScript keywords; callers add the reserved property names
/// of the files being printed.
pub struct ReservedPropNames<'a> {
    names: HashMap<&'a [u8], ()>,
}

impl<'a> ReservedPropNames<'a> {
    pub fn init() -> Self {
        let mut names = HashMap::new();
        for keyword in bun_ast::lexer_tables::KEYWORDS.keys() {
            names.insert(keyword, ());
        }
        Self { names }
    }

    pub fn reserve(&mut self, name: &'a [u8]) {
        self.names.insert(name, ());
    }

    fn contains(&self, name: &[u8]) -> bool {
        self.names.contains_key(name)
    }
}

/// A property to name: `ref_` is the (canonical) symbol, `count` how often the
/// property is used, and `stable_source_index` breaks ties between equally
/// used properties so output does not depend on parse order.
pub fn mangled_prop_candidate(
    ref_: Ref,
    count: u32,
    stable_source_index: u32,
) -> StableSymbolCount {
    StableSymbolCount {
        stable_source_index,
        ref_,
        count,
    }
}

/// Assigns a name to every candidate, writing them into `out` keyed by the
/// candidate's `ref_`. `char_freq` orders the alphabet so the most common
/// characters of the input make up the shortest names, as `--minify-identifiers`
/// does; without it the alphabet is used in its default order.
pub fn assign_mangled_prop_names(
    candidates: &mut [StableSymbolCount],
    reserved: &ReservedPropNames<'_>,
    char_freq: &CharFreq,
    out: &mut MangledProps,
) -> Result<(), bun_alloc::AllocError> {
    candidates.sort_unstable_by(StableSymbolCount::less_than);

    let minifier = char_freq.compile();
    let mut name: Vec<u8> = Vec::with_capacity(8);
    let mut next_name: isize = 0;

    out.ensure_unused_capacity(candidates.len())?;
    for candidate in candidates.iter() {
        loop {
            minifier.number_to_minified_name(&mut name, next_name)?;
            next_name += 1;
            if !reserved.contains(&name) {
                break;
            }
        }
        out.put_assume_capacity(candidate.ref_, name.as_slice().into());
    }

    Ok(())
}

/// Names the mangled properties of a file that is printed on its own
/// (`bun build --no-bundle`). `symbols` holds the file's symbols; `tree.symbols`
/// may already have been moved out of the AST by then. Returns `None` when the
/// file has no mangled properties.
pub fn mangled_props_for_single_file(
    tree: &Ast,
    symbols: &symbol::Map,
) -> Result<Option<MangledProps>, bun_alloc::AllocError> {
    let Some(file) = tree.property_mangling.as_deref() else {
        return Ok(None);
    };
    if file.mangled_props.is_empty() {
        return Ok(None);
    }

    let mut candidates: Vec<StableSymbolCount> = file
        .mangled_props
        .values()
        .iter()
        .map(|&ref_| {
            let count = symbols
                .get_const(ref_)
                .map_or(0, |symbol| symbol.use_count_estimate);
            mangled_prop_candidate(ref_, count, 0)
        })
        .collect();

    let mut reserved = ReservedPropNames::init();
    for name in file.reserved_props.keys() {
        reserved.reserve(name);
    }

    let mut out = MangledProps::new();
    assign_mangled_prop_names(
        &mut candidates,
        &reserved,
        &tree.char_freq.unwrap_or_default(),
        &mut out,
    )?;
    Ok(Some(out))
}
