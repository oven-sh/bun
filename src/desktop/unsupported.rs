//! What Electron has, and has nothing behind it here.

use crate::generated_bindgen::electron::ElectronInAppPurchase;

impl ElectronInAppPurchase {
    pub(crate) fn can_make_payments() -> bool {
        false
    }
}
