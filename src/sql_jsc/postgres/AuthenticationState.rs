#[derive(Clone, Copy)]
pub enum AuthenticationState {
    Pending,
    Ok,
    Sasl,
    SaslVerified { channel_bound: bool },
    Md5,
    ClearText,
}
