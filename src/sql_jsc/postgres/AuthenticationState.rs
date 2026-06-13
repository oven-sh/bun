use super::sasl::SASL;

pub enum AuthenticationState {
    Pending,
    None,
    Ok,
    Sasl(SASL),
    Md5,
}

impl AuthenticationState {
    pub fn zero(&mut self) {
        // Assigning into *self drops the previous variant (and thus SASL's
        // Drop impl) automatically; no explicit deinit is needed.
        *self = AuthenticationState::None;
    }
}
