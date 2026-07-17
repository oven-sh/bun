//! §8 Step 7.6 — wide error enum for group-B `?`-chains that previously
//! produced the `Resolver`/`Bundler`/`Install`/`Patch`/`Uws`/`Watcher` arms of
//! `bun_jsc::CrateError` (dropped at Step 6.3).

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error(transparent)]
    Jsc(#[from] bun_jsc::CrateError),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    Bundler(#[from] bun_bundler::Error),
    #[error(transparent)]
    Install(#[from] bun_install::Error),
    #[error(transparent)]
    Patch(#[from] bun_loop::patch::Error),
    #[error(transparent)]
    Uws(#[from] bun_uws_sys::Error),
    #[error(transparent)]
    Watcher(#[from] bun_sys::watcher::Error),
}

pub type Result<T> = core::result::Result<T, Error>;
