//! Font descriptions to `NSFont`.

use crate::geometry::Positive;
use crate::named_enum;
use crate::objc::appkit::{NSFont, NSFontDescriptor};

named_enum! {
    #[derive(Default)]
    pub enum Design {
        #[default]
        Default = "default",
        Monospaced = "monospaced",
        Rounded = "rounded",
        Serif = "serif",
    }
}

named_enum! {
    /// `NSFontWeight` buckets, named as CSS/SwiftUI name them.
    #[derive(Default)]
    pub enum Weight {
        Ultralight = "ultralight",
        Thin = "thin",
        Light = "light",
        #[default]
        Regular = "regular",
        Medium = "medium",
        Semibold = "semibold",
        Bold = "bold",
        Heavy = "heavy",
        Black = "black",
    }
}

impl Weight {
    /// Buckets a CSS 1–1000 weight.
    pub fn from_css(n: f64) -> Weight {
        match n {
            n if n < 150.0 => Weight::Ultralight,
            n if n < 250.0 => Weight::Thin,
            n if n < 350.0 => Weight::Light,
            n if n < 450.0 => Weight::Regular,
            n if n < 550.0 => Weight::Medium,
            n if n < 650.0 => Weight::Semibold,
            n if n < 750.0 => Weight::Bold,
            n if n < 850.0 => Weight::Heavy,
            n if n >= 850.0 => Weight::Black,
            // NaN
            _ => Weight::Regular,
        }
    }

    /// The `NSFontWeight` constant.
    fn ns(self) -> f64 {
        match self {
            Weight::Ultralight => -0.8,
            Weight::Thin => -0.6,
            Weight::Light => -0.4,
            Weight::Regular => 0.0,
            Weight::Medium => 0.23,
            Weight::Semibold => 0.3,
            Weight::Bold => 0.4,
            Weight::Heavy => 0.56,
            Weight::Black => 0.62,
        }
    }
}

/// A system font request.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Font {
    /// `None` for the standard system font size.
    pub size: Option<Positive>,
    pub weight: Weight,
    pub design: Design,
    pub italic: bool,
}

const ITALIC_TRAIT: u32 = 1 << 0;

impl Font {
    /// The `NSFont` closest to this description.
    pub(crate) fn to_nsfont(&self) -> NSFont {
        let weight = self.weight.ns();
        let size = self
            .size
            .map_or_else(NSFont::system_font_size, Positive::get);
        let mut font = match self.design {
            Design::Monospaced => NSFont::monospaced_system(size, weight),
            Design::Default | Design::Rounded | Design::Serif => {
                NSFont::system_weighted(size, weight)
            }
        };
        let design = match self.design {
            Design::Rounded => Some(NSFontDescriptor::system_design_rounded()),
            Design::Serif => Some(NSFontDescriptor::system_design_serif()),
            Design::Default | Design::Monospaced => None,
        };
        if let Some(design) = design {
            let designed = font
                .font_descriptor()
                .with_design(&design)
                .and_then(|d| NSFont::with_descriptor(&d, size));
            if let Some(f) = designed {
                font = f;
            }
        }
        if self.italic {
            let d = font.font_descriptor();
            let slanted = d.with_symbolic_traits(d.symbolic_traits() | ITALIC_TRAIT);
            if let Some(f) = NSFont::with_descriptor(&slanted, size) {
                font = f;
            }
        }
        font
    }
}
