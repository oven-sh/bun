#![warn(unused_must_use)]
pub mod tcc;
pub use tcc::{Config, ConfigErr, Error, OutputFormat, OwnedState, State, Symbol};
