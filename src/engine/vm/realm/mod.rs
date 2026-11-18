//! A global object and everything else that a realm has one of.

mod bad_time;
mod bindings;
mod console;
mod global_object;
mod global_proxy;
mod global_scope;
mod hooks;
mod sandbox;
mod slots;
mod watchpoints;

pub use bindings::{GlobalBinding, GlobalBindings};
pub use console::{ConsoleHooks, MessageLevel, MessageType};
pub use global_object::{GlobalObject, GlobalObjectInit};
pub use global_proxy::GlobalProxy;
pub(crate) use global_scope::Declarer;
pub use global_scope::{GlobalLexicals, GlobalPlace};
pub use hooks::{PromiseRejectionOperation, RealmHooks, ScriptExecutionStatus};
pub use sandbox::SandboxedGlobalObject;
pub use slots::RealmSlot;
pub use watchpoints::RealmWatchpoint;
