//! Container query properties: `container-type`, `container-name` and the
//! `container` shorthand.

use crate as css;
use crate::css_rules::container::ContainerName as ContainerIdent;
use crate::{Parser, PrintErr, Printer, Result as CssResult, SmallList};

/// The size half of [container-type](https://drafts.csswg.org/css-contain-3/#container-type).
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum ContainerSizeType {
    /// The element is a query container for inline size and block size queries.
    Size,
    /// The element is a query container for inline size queries.
    InlineSize,
}

/// A value for the [container-type](https://drafts.csswg.org/css-contain-3/#container-type) property.
///
/// `normal | [ [ size | inline-size ] || scroll-state ]`
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ContainerType {
    /// The size query container type, if any.
    pub(crate) size: Option<ContainerSizeType>,
    /// Whether the element is a query container for scroll-state queries.
    pub(crate) scroll_state: bool,
}

impl ContainerType {
    /// The `normal` keyword: not a query container.
    pub const NORMAL: Self = Self {
        size: None,
        scroll_state: false,
    };

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"normal"))
            .is_ok()
        {
            return Ok(Self::NORMAL);
        }
        let mut this = Self::NORMAL;
        loop {
            if this.size.is_none() {
                if let Ok(size) = input.try_parse(ContainerSizeType::parse) {
                    this.size = Some(size);
                    continue;
                }
            }
            if !this.scroll_state
                && input
                    .try_parse(|i| i.expect_ident_matching(b"scroll-state"))
                    .is_ok()
            {
                this.scroll_state = true;
                continue;
            }
            break;
        }
        if this == Self::NORMAL {
            return Err(input.new_error_for_next_token());
        }
        Ok(this)
    }

    pub fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self == Self::NORMAL {
            return dest.write_str("normal");
        }
        if let Some(size) = self.size {
            size.to_css(dest)?;
            if self.scroll_state {
                dest.write_char(b' ')?;
            }
        }
        if self.scroll_state {
            dest.write_str("scroll-state")?;
        }
        Ok(())
    }
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
            ContainerType::NORMAL
        };
        Ok(Container {
            name,
            container_type,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.name.to_css(dest)?;
        if self.container_type != ContainerType::NORMAL {
            dest.delim(b'/', true)?;
            self.container_type.to_css(dest)?;
        }
        Ok(())
    }
}
