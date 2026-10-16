//! Container query properties: `container-type`, `container-name` and the
//! `container` shorthand.

use crate as css;
use crate::css_rules::container::ContainerName as ContainerIdent;
use crate::{Parser, PrintErr, Printer, Result as CssResult, SmallList};

/// A value for the [container-type](https://drafts.csswg.org/css-contain-3/#container-type) property.
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty, css::CssEql, css::DeepClone)]
pub enum ContainerType {
    /// The element is not a query container for size queries.
    Normal,
    /// The element is a query container for inline size and block size queries.
    Size,
    /// The element is a query container for inline size queries.
    InlineSize,
    /// The element is a query container for scroll-state queries.
    ScrollState,
}

/// A value for the [container-name](https://drafts.csswg.org/css-contain-3/#container-name) property.
///
/// `none | <custom-ident>+`
#[derive(Clone, css::CssEql, css::DeepClone)]
pub enum ContainerName {
    /// The `none` keyword.
    None,
    /// One or more container names.
    Names(SmallList<ContainerIdent, 1>),
}

impl ContainerName {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(ContainerName::None);
        }
        let mut names = SmallList::default();
        while let Ok(name) = input.try_parse(ContainerIdent::parse) {
            names.append(name);
        }
        if names.len() == 0 {
            return Err(input.new_error_for_next_token());
        }
        Ok(ContainerName::Names(names))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            ContainerName::None => dest.write_str("none"),
            ContainerName::Names(names) => dest.write_separated(
                names.slice(),
                |d| d.write_char(b' '),
                |d, name| name.to_css(d),
            ),
        }
    }
}

/// A value for the [container](https://drafts.csswg.org/css-contain-3/#container-shorthand) shorthand property.
///
/// `<'container-name'> [ / <'container-type'> ]?`
#[derive(Clone, css::CssEql, css::DeepClone)]
pub struct Container {
    /// The container name.
    pub(crate) name: ContainerName,
    /// The container type.
    pub(crate) container_type: ContainerType,
}

impl Container {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let name = ContainerName::parse(input)?;
        let container_type = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
            ContainerType::parse(input)?
        } else {
            ContainerType::Normal
        };
        Ok(Container {
            name,
            container_type,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.name.to_css(dest)?;
        if self.container_type != ContainerType::Normal {
            dest.delim(b'/', true)?;
            self.container_type.to_css(dest)?;
        }
        Ok(())
    }
}
