#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum TLSStatus {
    None,
    Pending,
    MessageSent,
    SslOk,
}
