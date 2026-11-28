#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("UnknownFieldType")]
    UnknownFieldType,
    #[error(transparent)]
    Postgres(#[from] crate::postgres::any_postgres_error::AnyPostgresError),
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
