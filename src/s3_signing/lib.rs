#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod acl;
pub mod crate_error;
pub mod error;
pub mod storage_class;

pub use crate_error::Error;

pub mod credentials;

pub use acl::ACL;
pub use credentials::*;
pub use storage_class::StorageClass;
