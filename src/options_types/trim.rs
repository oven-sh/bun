pub use bun_removable_features::{Feature, FeatureSet, TrimFeature};

#[derive(Clone, Default, Debug)]
pub struct TrimRequest {
    pub removes_unused: bool,
    pub allow: Vec<TrimFeature>,
    pub remove: Vec<TrimFeature>,
    pub remove_internal: Vec<Feature>,
    pub locales: Option<Vec<Box<[u8]>>>,
    pub logs: bool,
}

impl TrimRequest {
    pub fn is_enabled(&self) -> bool {
        self.removes_unused || !self.remove.is_empty() || !self.remove_internal.is_empty()
    }
}
