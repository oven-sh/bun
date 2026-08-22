//! `Image`: an `NSImageView` showing a system symbol, a file or encoded bytes.

use super::{Cx, ImageSource, Orientation, Prop, Widget, priority};
use crate::error::{Error, Result};
use crate::geometry::{Positive, Rect};
use crate::objc;
use crate::objc::NsStr;
use crate::objc::appkit::{NSImage, NSImageSymbolConfiguration, NSImageView, NSView};
use crate::objc::foundation::{NSData, NSString};

/// `NSFontWeightRegular`.
const SYMBOL_WEIGHT_REGULAR: f64 = 0.0;

pub(crate) struct Image {
    view: NSImageView,
    symbol_size: Option<Positive>,
}

impl Image {
    pub(crate) fn new(_cx: &Cx<'_>) -> Image {
        let view = NSImageView::init_with_frame(objc::alloc::<NSImageView>(), Rect::default());
        view.set_editable(false);
        // A large bitmap should shrink to fit its container rather than
        // force the window to its pixel size.
        for axis in Orientation::BOTH {
            view.set_content_compression_resistance_priority(priority::DEFAULT_LOW, axis);
        }
        Image {
            view,
            symbol_size: None,
        }
    }

    fn apply_symbol_size(&self) {
        let configuration = self.symbol_size.map(|size| {
            NSImageSymbolConfiguration::with_point_size(size.get(), SYMBOL_WEIGHT_REGULAR)
        });
        self.view.set_symbol_configuration(configuration.as_ref());
    }

    fn load(source: &ImageSource<'_>) -> Result<Option<NSImage>> {
        Ok(match *source {
            ImageSource::None => None,
            ImageSource::Symbol(name) => Some(system_symbol(name)?),
            ImageSource::File(path) => {
                let ns_path = NSString::from_str(path);
                let image = NSImage::init_with_contents_of_file(objc::alloc::<NSImage>(), &ns_path)
                    .ok_or_else(|| Error::BadImageFile(ns_path.to_string_lossy()))?;
                Some(image)
            }
            ImageSource::Data(bytes) => {
                let image =
                    NSImage::init_with_data(objc::alloc::<NSImage>(), &NSData::from_bytes(bytes))
                        .ok_or(Error::BadImageData)?;
                Some(image)
            }
        })
    }
}

/// The SF Symbol called `name`.
pub(crate) fn system_symbol(name: NsStr<'_>) -> Result<NSImage> {
    let ns = NSString::from_str(name);
    NSImage::system_symbol(&ns, None).ok_or_else(|| Error::UnknownSymbol(ns.to_string_lossy()))
}

impl Widget for Image {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Image(source) => {
                let image = Image::load(&source)?;
                self.view.set_image(image.as_ref());
                self.apply_symbol_size();
            }
            Prop::Scaling(s) => self.view.set_image_scaling(s.into()),
            Prop::Tint(color) => {
                let color = color.map(|c| c.to_nscolor());
                self.view.set_content_tint_color(color.as_ref());
            }
            Prop::SymbolSize(size) => {
                self.symbol_size = size;
                self.apply_symbol_size();
            }
            Prop::Enabled(b) => self.view.set_enabled(b),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }
}
