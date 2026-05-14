use crate as css;
use crate::PrintErr;
use crate::css_parser::Parser;
use crate::printer::Printer;

use crate::css_values::ident::{CustomIdent, CustomIdentList};

use crate::dependencies::Location;

use bun_alloc::Arena; // bumpalo::Bump re-export (CSS is an AST/arena crate)
use bun_wyhash::Wyhash;

/// A value for the [composes](https://github.com/css-modules/css-modules/#dependencies) property from CSS modules.
pub struct Composes {
    /// A list of class names to compose.
    pub names: CustomIdentList,
    /// Where the class names are composed from.
    pub from: Option<Specifier>,
    /// The source location of the `composes` property.
    pub loc: bun_ast::Loc,
    pub cssparser_loc: Location,
}

impl Composes {
    pub fn parse(input: &mut Parser) -> css::Result<Composes> {
        let loc = input.position();
        let loc2 = input.current_source_location();
        let mut names = CustomIdentList::default();
        while let Ok(name) = input.try_parse(Self::parse_one_ident) {
            names.append(name);
        }

        if names.len() == 0 {
            return Err(input.new_custom_error(css::ParserError::invalid_declaration));
        }

        let from = if input
            .try_parse(|i| i.expect_ident_matching(b"from"))
            .is_ok()
        {
            Some(Specifier::parse(input)?)
        } else {
            None
        };

        Ok(Composes {
            names,
            from,
            loc: bun_ast::Loc {
                start: i32::try_from(loc).expect("int cast"),
            },
            cssparser_loc: Location::from_source_location(loc2),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::ident::CustomIdentFns;
        dest.write_separated(
            self.names.slice(),
            |d| d.write_char(b' '),
            |d, name| CustomIdentFns::to_css(name, d),
        )?;

        if let Some(from) = &self.from {
            dest.write_str(b" from ")?;
            from.to_css(dest)?;
        }
        Ok(())
    }

    fn parse_one_ident(input: &mut Parser) -> css::Result<CustomIdent> {
        let name: CustomIdent = CustomIdent::parse(input)?;

        if bun_core::eql_case_insensitive_ascii_check_length(name.v(), b"from") {
            return Err(input.new_error_for_next_token());
        }

        Ok(name)
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // PORT NOTE: Zig `css.implementDeepClone` is comptime field reflection.
        // `CustomIdent` is `Copy` (arena-ptr payload), so an element-wise copy
        // into a fresh `SmallList` is the deep clone.
        let mut names = CustomIdentList::default();
        for name in self.names.slice() {
            names.append(*name);
        }
        Composes {
            names,
            from: self.from.as_ref().map(|f| f.deep_clone(bump)),
            loc: self.loc,
            cssparser_loc: self.cssparser_loc,
        }
    }

    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // PORT NOTE: Zig `css.implementEql` is comptime field reflection.
        if lhs.names.len() != rhs.names.len() {
            return false;
        }
        for (a, b) in lhs.names.slice().iter().zip(rhs.names.slice().iter()) {
            if a.v() != b.v() {
                return false;
            }
        }
        match (&lhs.from, &rhs.from) {
            (None, None) => {}
            (Some(a), Some(b)) if Specifier::eql(a, b) => {}
            _ => return false,
        }
        lhs.loc == rhs.loc && lhs.cssparser_loc == rhs.cssparser_loc
    }
}

/// Defines where the class names referenced in the `composes` property are located.
///
/// See [Composes](Composes).
#[derive(Debug, Clone, Copy)]
pub enum Specifier {
    /// The referenced name is global.
    Global,
    /// The referenced name comes from the specified file.
    ///
    /// Is an import record index
    ImportRecordIndex(u32),
}

// `generics::CssEql` so the `Option<Specifier>` blanket (used by
// `DashedIdentReference::eql` in values/ident.rs) resolves. Forwards to the
// inherent `eql` below — same shape the old data-only stub in `values/mod.rs`
// carried before this leaf un-gated.
impl crate::generics::CssEql for Specifier {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        Specifier::eql(self, other)
    }
}

impl Specifier {
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // PORT NOTE: Zig `css.implementEql` (variant-wise reflection) → hand-match.
        match (lhs, rhs) {
            (Specifier::Global, Specifier::Global) => true,
            (Specifier::ImportRecordIndex(a), Specifier::ImportRecordIndex(b)) => a == b,
            _ => false,
        }
    }

    pub fn parse(input: &mut Parser) -> css::Result<Specifier> {
        let start_position = input.position();
        if let Ok(file) = input.try_parse(|i| {
            let s = i.expect_url_or_string()?;
            // SAFETY: `s` borrows the parser source/arena which outlives the
            // `add_import_record` call. Detach the borrow so `input` is reusable
            // (same trick as `css_parser::src_str` — Token payloads are arena-static).
            Ok::<&'static [u8], _>(unsafe { &*std::ptr::from_ref::<[u8]>(s) })
        }) {
            let import_record_index =
                input.add_import_record(file, start_position, bun_ast::ImportKind::Composes)?;
            return Ok(Specifier::ImportRecordIndex(import_record_index));
        }
        input.expect_ident_matching(b"global")?;
        Ok(Specifier::Global)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Specifier::Global => dest.write_str(b"global"),
            Specifier::ImportRecordIndex(import_record_index) => {
                let url = dest.get_import_record_url(*import_record_index)?;
                // SAFETY: `url` borrows printer-owned import-record storage
                // which outlives the `serialize_string` call. Detach so `dest`
                // is reborrowable as the `WriteAll` sink.
                let url: &[u8] = unsafe { &*std::ptr::from_ref::<[u8]>(url) };
                dest.serialize_string(url)
            } // .source_index => {},
        }
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        // PORT NOTE: Zig `css.implementDeepClone` — variants are `Copy`.
        *self
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        // PORT NOTE: Zig `css.implementHash` (variant-wise reflection) → hand-match.
        match self {
            Specifier::Global => hasher.update(&0u32.to_ne_bytes()),
            Specifier::ImportRecordIndex(i) => {
                hasher.update(&1u32.to_ne_bytes());
                hasher.update(&i.to_ne_bytes());
            }
        }
    }
}

// ported from: src/css/properties/css_modules.zig
