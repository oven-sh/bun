//! Cloud credentials without an SDK: the AWS default credential provider
//! chain + SigV4 (`Bun.s3`, `fetch("s3://…")`, `Bun.aws` / `Bun.AWSClient`)
//! and Google application default credentials (`Bun.gcp` / `Bun.GCPClient`).
//! `flight`/`io`/`cache`/`json`/`env` are the shared plumbing.

pub mod aws;
pub mod cache;
pub mod env;
pub mod flight;
pub mod gcp;
pub mod io;
pub mod json;

/// Per-VM state (lives in `RareData`, dropped with the VM): the credential
/// providers, the resolutions currently in flight and their waiters, for
/// both clouds. A Worker has its own, so its own `env` yields its own
/// credentials.
#[derive(Default)]
pub(crate) struct PerVm {
    pub aws: flight::Flights<aws::DefaultProvider>,
    pub gcp: flight::Flights<gcp::provider::TokenProvider>,
}

impl PerVm {
    /// JS thread only. Callers keep the borrow short and never hold it across
    /// a call that may re-enter (continuations, JS).
    pub(crate) fn get(vm: &bun_jsc::virtual_machine::VirtualMachine) -> &mut PerVm {
        vm.as_mut()
            .rare_data()
            .cloud_credentials
            .get_or_insert_with(|| Box::new(PerVm::default()))
            .downcast_mut::<PerVm>()
            .expect("RareData.cloud_credentials holds cloud::PerVm")
    }
}
