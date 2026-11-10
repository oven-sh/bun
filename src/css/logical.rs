#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum PropertyCategory {
    Logical,
    #[default]
    Physical,
}
