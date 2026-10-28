use bun_jsc::{JSGlobalObject, JSValue, JsError};
use bun_removable_features::Feature;

unsafe extern "C" {
    safe fn Bun__throwForRemovedFeature(global: &JSGlobalObject, feature: u16) -> JSValue;
    safe fn Bun__createStandInForRemovedInstance(
        global: &JSGlobalObject,
        constructor: JSValue,
    ) -> JSValue;
}

pub(crate) fn stand_in_for_removed_instance(
    global: &JSGlobalObject,
    constructor: JSValue,
) -> JSValue {
    Bun__createStandInForRemovedInstance(global, constructor)
}

pub(crate) fn throw_for_removed_feature(global: &JSGlobalObject, feature: Feature) -> JsError {
    Bun__throwForRemovedFeature(global, feature.index());
    JsError::Thrown
}
