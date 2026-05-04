use crate as css;
use crate::Printer;
use crate::PrintErr;

use crate::css_values::ident::CustomIdent;
use crate::css_values::ident::CustomIdentList;
use crate::css_values::ident::CustomIdentFns;

use crate::dependencies::Location;

use bun_alloc::Arena; // bumpalo::Bump re-export (CSS is an AST/arena crate)

/// A value for the [composes](https://github.com/css-modules/css-modules/#dependencies) property from CSS modules.
pub struct Composes {
    /// A list of class names to compose.
    pub names: CustomIdentList,
    /// Where the class names are composed from.
    pub from: Option<Specifier>,
    /// The source location of the `composes` property.
    pub loc: bun_logger::Loc,
    pub cssparser_loc: Location,
}

impl Composes {
    pub fn parse(input: &mut css::Parser) -> css::Result<Composes> {
        let loc = input.position();
        let loc2 = input.current_source_location();
        let mut names = CustomIdentList::default();
        while let Some(name) = input.try_parse(Self::parse_one_ident).ok() {
            names.append(input.allocator(), name);
        }

        if names.len() == 0 {
            return Err(input.new_custom_error(css::ParserError::InvalidDeclaration));
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
            loc: bun_logger::Loc {
                start: i32::try_from(loc).unwrap(),
            },
            cssparser_loc: Location::from_source_location(loc2),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut first = true;
        for name in self.names.slice() {
            if first {
                first = false;
            } else {
                dest.write_char(b' ')?;
            }
            CustomIdentFns::to_css(name, dest)?;
        }

        if let Some(from) = &self.from {
            dest.write_str(b" from ")?;
            from.to_css(dest)?;
        }
        Ok(())
    }

    fn parse_one_ident(input: &mut css::Parser) -> css::Result<CustomIdent> {
        let name: CustomIdent = CustomIdent::parse(input)?;

        if bun_str::strings::eql_case_insensitive_ascii(name.v, b"from", true) {
            return Err(input.new_error_for_next_token());
        }

        Ok(name)
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — replace with #[derive] or hand-impl in Phase B
        css::implement_deep_clone(self, bump)
    }

    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // TODO(port): css.implementEql uses @typeInfo field reflection — replace with #[derive(PartialEq)] in Phase B
        css::implement_eql(lhs, rhs)
    }
}

/// Defines where the class names referenced in the `composes` property are located.
///
/// See [Composes](Composes).
pub enum Specifier {
    /// The referenced name is global.
    Global,
    /// The referenced name comes from the specified file.
    ///
    /// Is an import record index
    ImportRecordIndex(u32),
}

impl Specifier {
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // TODO(port): css.implementEql uses @typeInfo reflection — replace with #[derive(PartialEq)] in Phase B
        css::implement_eql(lhs, rhs)
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<Specifier> {
        let start_position = input.position();
        if let Some(file) = input.try_parse(css::Parser::expect_url_or_string).ok() {
            let import_record_index =
                input.add_import_record(file, start_position, bun_options_types::ImportKind::Composes)?;
            return Ok(Specifier::ImportRecordIndex(import_record_index));
        }
        if let Some(e) = input.expect_ident_matching(b"global").err() {
            return Err(e);
        }
        Ok(Specifier::Global)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Specifier::Global => dest.write_str(b"global"),
            Specifier::ImportRecordIndex(import_record_index) => {
                let url = dest.get_import_record_url(*import_record_index)?;
                css::serializer::serialize_string(url, dest).map_err(|_| dest.add_fmt_error())
            }
            // .source_index => {},
        }
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo reflection — replace with #[derive(Clone)] in Phase B
        css::implement_deep_clone(self, bump)
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // TODO(port): css.implementHash uses @typeInfo reflection — replace with #[derive(Hash)] in Phase B
        css::implement_hash(self, hasher)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/css_modules.zig (138 lines)
//   confidence: medium
//   todos:      5
//   notes:      implement_{eql,deep_clone,hash} are comptime-reflection helpers — Phase B should replace with derives; css::Result<T> assumed to be Result<T, ParseError>
// ──────────────────────────────────────────────────────────────────────────
