pub mod check_lines;
pub mod commands;
#[path = "../../standalone/engine_stubs.rs"]
mod engine_stubs;
#[path = "../../standalone/options.rs"]
pub mod standalone_options;
pub mod test_file;

#[derive(PartialEq, Eq, Debug)]
pub struct TestFailure {
    pub line: u32,
    pub message: String,
}
