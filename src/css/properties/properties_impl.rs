use crate as css;

use css::css_properties::CustomPropertyName;
use css::Printer;
use css::PrintErr;
use css::VendorPrefix;
use css::PropertyId;
use css::Property;

use bun_str::strings;

pub mod property_id_mixin {
    use super::*;

    pub fn to_css(this: &PropertyId, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut first = true;
        let name = this.name();
        let prefix_value = this.prefix().or_none();

        // PORT NOTE: Zig `inline for (VendorPrefix.FIELDS) |field|` + `@field` iterates each
        // bitflag field and tests it. In Rust, `VendorPrefix::FIELDS` is a const slice of
        // single-bit flags in the same declaration order; `contains` replaces the `@field` test.
        for &flag in VendorPrefix::FIELDS {
            if prefix_value.contains(flag) {
                let prefix = flag;

                if first {
                    first = false;
                } else {
                    dest.delim(b',', false)?;
                }
                prefix.to_css(dest)?;
                dest.write_str(name)?;
            }
        }
        Ok(())
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<PropertyId> {
        // PORT NOTE: `css::Result<T>` is assumed to alias `Result<T, css::ParserError>`;
        // the Zig `.result`/`.err` switch collapses to `?`.
        let name = input.expect_ident()?;
        Ok(from_string(name))
    }

    pub fn from_string(name_: &[u8]) -> PropertyId {
        let name_ref = name_;
        let prefix: VendorPrefix;
        let trimmed_name: &[u8];

        // TODO: todo_stuff.match_ignore_ascii_case
        if strings::starts_with_case_insensitive_ascii(name_ref, b"-webkit-") {
            prefix = VendorPrefix::WEBKIT;
            trimmed_name = &name_ref[8..];
        } else if strings::starts_with_case_insensitive_ascii(name_ref, b"-moz-") {
            prefix = VendorPrefix::MOZ;
            trimmed_name = &name_ref[5..];
        } else if strings::starts_with_case_insensitive_ascii(name_ref, b"-o-") {
            prefix = VendorPrefix::O;
            trimmed_name = &name_ref[3..];
        } else if strings::starts_with_case_insensitive_ascii(name_ref, b"-ms-") {
            prefix = VendorPrefix::MS;
            trimmed_name = &name_ref[4..];
        } else {
            prefix = VendorPrefix::NONE;
            trimmed_name = name_ref;
        }

        PropertyId::from_name_and_prefix(trimmed_name, prefix)
            .unwrap_or_else(|| PropertyId::Custom(CustomPropertyName::from_str(name_)))
    }
}

pub mod property_mixin {
    use super::*;

    /// Serializes the CSS property, with an optional `!important` flag.
    pub fn to_css(this: &Property, dest: &mut Printer, important: bool) -> Result<(), PrintErr> {
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
        let mut first = true;

        // PORT NOTE: see property_id_mixin::to_css for the `inline for` + `@field` mapping.
        for &flag in VendorPrefix::FIELDS {
            if prefix.contains(flag) {
                let p = flag;

                if first {
                    first = false;
                } else {
                    dest.write_char(b';')?;
                    dest.newline()?;
                }
                p.to_css(dest)?;
                dest.write_str(name)?;
                dest.delim(b':', false)?;
                this.value_to_css(dest)?;
                if important {
                    dest.whitespace()?;
                    dest.write_str(b"!important")?;
                }
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/properties_impl.zig (109 lines)
//   confidence: medium
//   todos:      0
//   notes:      VendorPrefix needs `FIELDS: &[Self]` const + `contains()`; mixin mods may become inherent `impl PropertyId`/`impl Property` blocks in Phase B
// ──────────────────────────────────────────────────────────────────────────
