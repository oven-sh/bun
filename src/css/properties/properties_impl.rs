use crate as css;

use css::PrintErr;
use css::Printer;
use css::VendorPrefix;
use css::css_properties::CustomPropertyName;
use css::css_properties::{Property, PropertyId, PropertyIdTag};

impl Property {
    #[inline]
    pub fn variant_tag(&self) -> PropertyIdTag {
        match self {
            Property::Unparsed(_) => PropertyIdTag::Unparsed,
            Property::Custom(_) => PropertyIdTag::Custom,
            // Every other `Property` variant maps 1:1 onto its `PropertyId`
            // variant, so `property_id().tag()` is the discriminant.
            _ => self.property_id().tag(),
        }
    }
}

pub(super) const PREFIX_FLAGS: [VendorPrefix; 5] = [
    VendorPrefix::WEBKIT,
    VendorPrefix::MOZ,
    VendorPrefix::MS,
    VendorPrefix::O,
    VendorPrefix::NONE,
];

pub(super) mod property_id_mixin {
    use super::*;

    pub(crate) fn to_css(this: &PropertyId, dest: &mut Printer) -> Result<(), PrintErr> {
        let name = this.name();
        let prefix_value = this.prefix().or_none();

        // PORT NOTE: Zig `inline for (VendorPrefix.FIELDS) |field|` + `@field` iterates each
        // bitflag field and tests it. `PREFIX_FLAGS` is the same set in the same order;
        // `contains` replaces the `@field` test.
        dest.write_comma_separated(
            PREFIX_FLAGS
                .iter()
                .copied()
                .filter(|p| prefix_value.contains(*p)),
            |d, p| {
                p.to_css(d)?;
                d.write_str(name)
            },
        )
    }

    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<PropertyId> {
        // PORT NOTE: `css::Result<T>` is assumed to alias `Result<T, css::ParserError>`;
        // the Zig `.result`/`.err` switch collapses to `?`.
        let name = input.expect_ident()?;
        Ok(from_string(name))
    }

    pub(crate) fn from_string(name_: &[u8]) -> PropertyId {
        let (prefix, trimmed_name) = VendorPrefix::strip_from(name_);
        PropertyId::from_name_and_prefix(trimmed_name, prefix)
            .unwrap_or_else(|| PropertyId::Custom(CustomPropertyName::from_str(name_)))
    }
}

pub(super) mod property_mixin {
    use super::*;

    /// Serializes the CSS property, with an optional `!important` flag.
    pub(crate) fn to_css(
        this: &Property,
        dest: &mut Printer,
        important: bool,
    ) -> Result<(), PrintErr> {
        if let Property::Custom(custom) = this {
            custom.name.to_css(dest)?;
            dest.delim(b':', false)?;
            this.value_to_css(dest)?;
            if important {
                dest.whitespace()?;
                dest.write_str(b"!important")?;
            }
            return Ok(());
        }
        let (name, prefix) = this.__to_css_helper();

        // PORT NOTE: see property_id_mixin::to_css for the `inline for` + `@field` mapping.
        dest.write_separated(
            PREFIX_FLAGS.iter().copied().filter(|p| prefix.contains(*p)),
            |d| {
                d.write_char(b';')?;
                d.newline()
            },
            |d, p| {
                p.to_css(d)?;
                d.write_str(name)?;
                d.delim(b':', false)?;
                this.value_to_css(d)?;
                if important {
                    d.whitespace()?;
                    d.write_str(b"!important")?;
                }
                Ok(())
            },
        )
    }
}

// ported from: src/css/properties/properties_impl.zig
