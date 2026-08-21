use crate::Named;
use crate::view::Kind;

pub type Result<T, E = Error> = core::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A framework or symbol could not be loaded; `.0` is the dlerror text or `symbol <name>`.
    #[error("AppKit could not be loaded: {0}")]
    Load(String),
    /// Called from a thread other than the process main thread.
    #[error("AppKit objects can only be used from the main thread")]
    WrongThread,
    /// `kind` does not use this property.
    #[error("{} does not support this property", .0.name())]
    UnknownProp(Kind),
    /// Children were added to a view kind that has none.
    #[error("{} cannot have children", .0.name())]
    NotAContainer(Kind),
    /// A single-child container already has its child.
    #[error("{} takes a single child; remove the current one first", .0.name())]
    AlreadyHasChild(Kind),
    #[error("view already has a parent; call remove() first")]
    ChildHasParent,
    #[error("a view cannot contain itself or one of its ancestors")]
    WouldCycle,
    #[error("view is not a child of this container")]
    NotAChild,
    /// firstBaseline/lastBaseline on a vertical stack.
    #[error("firstBaseline/lastBaseline alignment only applies to a horizontal stack")]
    BaselineAlignOnVerticalStack,
    #[error("invalid color {0:?}")]
    BadColor(String),
    #[error(
        "{0:?} is not an action selector; expected an identifier ending in one \":\", like \"copy:\""
    )]
    BadSelector(String),
    /// No SF Symbol with this name.
    #[error("no system symbol named {0:?}")]
    UnknownSymbol(String),
    /// The file does not exist or is not an image AppKit can decode; `.0` is the path.
    #[error("could not load image file {0:?}")]
    BadImageFile(String),
    #[error("unrecognized image data")]
    BadImageData,
    #[error("window is closed")]
    WindowClosed,
    /// `-[NSWindow setFrameAutosaveName:]` answered NO.
    #[error("another window already uses restoreName {0:?}")]
    RestoreNameInUse(String),
    /// `-[NSApplication setActivationPolicy:]` answered NO.
    #[error("the activation policy cannot be changed to \"{}\" now", .0.name())]
    ActivationPolicyRefused(crate::app::ActivationPolicy),
}
