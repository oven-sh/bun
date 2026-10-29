#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct EntryPointPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FolderPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

/// Positions among the entry points of the build.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RefusedEntryPoints {
    /// They reach a file with an error.
    pub refused: Vec<u32>,
    /// They reach a file with an error that is no type error.
    pub refused_without_types: Vec<u32>,
    pub files_with_type_errors: Vec<Vec<u8>>,
}
