use crate as css;

use css::PrintErr;
use css::Printer;
use css::VendorPrefix;
use css::css_properties::CustomPropertyName;
use css::css_properties::{Property, PropertyId};

/// Ordered single-bit prefix flags. The crate-root `VendorPrefix::FIELDS` is
/// a `&'static [VendorPrefix]` with the same values in the same declaration
/// order (webkit, moz, ms, o, none); kept duplicated here as a fixed-size
/// array for the to_css loops.
const PREFIX_FLAGS: [VendorPrefix; 5] = [
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

        // `PREFIX_FLAGS` matches `VendorPrefix::FIELDS` — same set, same
        // order; serialization order of prefixed names depends on it.
        dest.write_comma_separated(
            PREFIX_FLAGS
                .iter()
                .copied()
                .filter(|p| prefix_value.contains(*p)),
            |d, p| {
                p.to_css(d)?;
                match this {
                    PropertyId::Custom(_) => d.serialize_identifier(name),
                    _ => d.write_str(name),
                }
            },
        )
    }

    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<PropertyId> {
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
