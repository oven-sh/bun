#![warn(unused_must_use)]
pub mod tcc;
pub use tcc::{
    Config, ConfigErr, Error, OpenFiles, Opened, OutputFormat, OwnedState, State, Symbol,
};
