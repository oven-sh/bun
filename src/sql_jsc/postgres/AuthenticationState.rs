use super::sasl::SASL;

pub enum AuthenticationState {
    Pending,
    Ok,
    Sasl(Box<SASL>),
    SaslVerified { channel_bound: bool },
    Md5,
    ClearText,
}
