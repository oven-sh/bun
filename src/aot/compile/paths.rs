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

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FollowedName {
    pub folder_and_name_as_written: Vec<u8>,
    pub public_path_for_require: Option<Vec<u8>>,
    pub public_path_for_import: Option<Vec<u8>>,
}
