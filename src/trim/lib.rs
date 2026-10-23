#![warn(unused_must_use)]

mod apply;
mod decide;
mod edges;
mod error;
mod icu_data;
mod locales;
mod model;
mod plan;
mod settings;
mod summary;
pub mod table;

pub use apply::apply;
pub use bun_exe_format::cut_model::{NoCutReason, Uncut, UncutReason};
pub use bun_removable_features::{
    EnteredFrom, Feature, FeatureSet, Removal, RuntimeRequirement, TrimFeature,
};
pub use decide::{decide, features_kept_only_when_named};
pub use error::{TrimError, TrimInternalError, TrimRequestError, UnsupportedReason};
pub use model::{
    Decision, EdgeStrength, ExecutableSettings, FeatureEdge, FeatureEdges, LocaleTag,
    OptionRequirement, RetainReason, Retained, TrimInput, TrimPlan, TrimSummary, UnseenCode,
    UnseenCodeCause, UsedFeature, UsedFeatures, UsedLocales, WitnessIndex,
};
pub use plan::{plan, read_feature_edges};
pub use settings::collect_requirements;
pub use summary::{write_log_lines, write_warning_lines};

#[cfg(test)]
use bun_sema_standalone as _;
