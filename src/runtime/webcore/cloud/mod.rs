//! Cloud credentials without an SDK: the AWS default credential provider
//! chain + SigV4 (`Bun.s3`, `fetch("s3://…")`, `fetch(url, { aws })`,
//! `Bun.aws`) and Google application default credentials (`fetch(url, { gcp })`,
//! `Bun.gcp`). `http_sync`/`json`/`env`/`cache` are the shared plumbing.

pub mod aws;
pub mod cache;
pub mod env;
pub mod gcp;
pub mod http_sync;
pub mod json;

/// Per-VM state (lives in `RareData`, dropped with the VM): the credential
/// caches and the resolutions currently in flight, for both clouds. A Worker
/// has its own, so its own `env` yields its own credentials.
#[derive(Default)]
pub(crate) struct PerVm {
    pub aws: aws::provider::State,
    pub gcp: gcp::provider::State,
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
