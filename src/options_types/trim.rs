pub use bun_removable_features::{Feature, FeatureSet, TrimFeature};

#[derive(Clone, Default, Debug)]
pub struct TrimRequest {
    pub removes_unused: bool,
    pub allow: Vec<TrimFeature>,
    pub remove: Vec<TrimFeature>,
    pub remove_internal: Vec<Feature>,
    pub locales: Option<Vec<Box<[u8]>>>,
    pub logs: bool,
    /// The result is what other executables are built on: it keeps all that a program can ask for, and can be trimmed again.
    pub is_template: bool,
}

impl TrimRequest {
    pub fn is_enabled(&self) -> bool {
        self.removes_unused
            || !self.remove.is_empty()
            || !self.remove_internal.is_empty()
            || self.is_template
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_not_enabled() {
        assert!(!TrimRequest::default().is_enabled());
    }

    #[test]
    fn removes_unused_enables() {
        let request = TrimRequest {
            removes_unused: true,
            ..TrimRequest::default()
        };
        assert!(request.is_enabled());
    }

    #[test]
    fn remove_internal_enables() {
        let request = TrimRequest {
            remove_internal: vec![Feature::Jit],
            ..TrimRequest::default()
        };
        assert!(request.is_enabled());
    }

    #[test]
    fn template_enables() {
        let request = TrimRequest {
            is_template: true,
            ..TrimRequest::default()
        };
        assert!(request.is_enabled());
    }

    #[test]
    fn allow_alone_does_not_enable() {
        let request = TrimRequest {
            allow: vec![TrimFeature::ALL[0]],
            ..TrimRequest::default()
        };
        assert!(!request.is_enabled());
    }

    #[test]
    fn logs_alone_does_not_enable() {
        let request = TrimRequest {
            logs: true,
            ..TrimRequest::default()
        };
        assert!(!request.is_enabled());
    }

    #[test]
    fn locales_alone_do_not_enable() {
        let request = TrimRequest {
            locales: Some(vec![Box::from(&b"de"[..])]),
            ..TrimRequest::default()
        };
        assert!(!request.is_enabled());
    }
}
