#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod acl;
pub mod error;
pub mod storage_class;

pub mod credentials;

pub use acl::ACL;
pub use credentials::*;
pub use error::{ErrorCodeAndMessage, S3Error};
pub use storage_class::StorageClass;
