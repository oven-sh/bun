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
    /// Not one of the standard action selectors [`crate::ActionSelector`] lists.
    #[error(
        "{0:?} is not a supported menu action selector; expected a standard one such as \"copy:\", \"performClose:\" or \"toggleFullScreen:\""
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
    /// Metal could not be loaded or there is no Metal device (`MTLCreateSystemDefaultDevice` gave nil).
    #[error("Metal is not available")]
    NoGpu,
    /// A range does not fit the buffer, texture, slice or render target it addresses.
    #[error("{what} out of bounds: offset {offset} + size {size} exceeds {len}")]
    OutOfBounds {
        what: &'static str,
        len: usize,
        offset: usize,
        size: usize,
    },
    /// A bind slot, attachment index or count is past a fixed Metal limit.
    #[error("{what} {index} is out of range (limit {limit})")]
    IndexOutOfRange {
        what: &'static str,
        index: usize,
        limit: usize,
    },
    /// A length, extent or count that Metal requires to be non-zero.
    #[error("{0} must be greater than zero")]
    ZeroSize(&'static str),
    /// The Metal compiler rejected the source; `message` is its log with line:column locations.
    #[error("shader compilation failed:\n{message}")]
    ShaderCompile { message: String },
    #[error("no shader function named {name:?}; the library has {available:?}")]
    NoSuchFunction {
        name: String,
        available: Vec<String>,
    },
    /// A pipeline could not be built, or does not match the pass it was set on.
    #[error("invalid pipeline: {message}")]
    Pipeline { message: String },
    /// Metal could not create an object or the command buffer finished with an error.
    #[error("GPU execution failed: {message}")]
    GpuExecution { message: String },
    /// `set…Bytes` copies at most 4096 bytes; use a buffer for more.
    #[error("{0} bytes is too large to set inline (limit 4096); use a buffer")]
    InlineBytesTooLarge(usize),
    #[error(
        "texture is not CPU-accessible (private storage or a drawable); render or blit into a readable texture instead"
    )]
    TextureNotReadable,
    #[error("buffer has private storage; the CPU cannot read or write it")]
    BufferNotAccessible,
    /// A frame method was called in the wrong phase (`actual`).
    #[error("frame is {actual}; expected it to be {expected}")]
    FrameState {
        expected: &'static str,
        actual: &'static str,
    },
    #[error("set a pipeline on the pass before drawing or dispatching")]
    NoPipeline,
    /// The view has no drawable to render into this frame.
    #[error("the view has no drawable to render into")]
    NoDrawable,
    /// An operation the object was not created to support; `.0` says which and why.
    #[error("{0}")]
    Unsupported(&'static str),
    /// The object is not in a state where this can be done now; `.0` says which and why.
    #[error("{0}")]
    InvalidState(&'static str),
    /// `objc_getClass` knows no class by this name.
    #[error("objc: no class named {0:?}")]
    NoClass(String),
    /// The receiver does not respond to `sel`; `class` names its class and
    /// `instance` picks `-` over `+`.
    #[error("{}[{class} {sel}]: unrecognized selector", if *.instance { '-' } else { '+' })]
    Unrecognized {
        class: String,
        sel: String,
        instance: bool,
    },
    /// `method` is the `-[Class selector]` form.
    #[error("{method}: expected {expected} argument(s), got {got}")]
    ArgCount {
        method: String,
        expected: usize,
        got: usize,
    },
    /// Argument `index` (from 0) cannot be passed as the type the method declares.
    #[error("{method}: argument {index} must be {expected}, got {got}")]
    ArgType {
        method: String,
        index: usize,
        expected: String,
        got: String,
    },
    /// The method's signature uses something the dynamic bridge cannot marshal yet.
    #[error("{method}: {what}")]
    UnsupportedSignature { method: String, what: String },
    /// An `init…` message took ownership of this object; only the object it returned is usable.
    #[error("this object was consumed by init; use the object init returned")]
    Consumed,
    /// The handle is an `alloc()` result that has not been sent an `init…` yet.
    #[error("this object came from alloc(); call an init… method on it first")]
    NotInitialized,
    #[error("ObjCObject has been released")]
    ObjectReleased,
}
