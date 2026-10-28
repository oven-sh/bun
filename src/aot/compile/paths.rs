#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntryPointPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FolderPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}
