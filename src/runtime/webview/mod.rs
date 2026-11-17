//! WebView host-process management. macOS uses a `WKWebView`-backed host
//! subprocess; other platforms drive Chrome over the CDP
//! pipe. The C++ backends (WebKitBackend.cpp /
//! ChromeBackend.cpp) own the usockets client and frame protocol; this module
//! only spawns/watches the child.

#[path = "ChromeProcess.rs"]
pub(crate) mod chrome_process;
#[path = "HostProcess.rs"]
pub(crate) mod host_process;

use bun_ptr::{AliasableBox, CellExt as _, VecCellExt as _};
use bun_removable_features::removable_body_behind_value;
use core::cell::Cell;
use core::mem::ManuallyDrop;

/// The processes of a backend that this VM has spawned and not reaped, the newest last.
type Unreaped<T> = ManuallyDrop<Cell<Vec<AliasableBox<T>>>>;

/// Not dropped with the runtime state: the polls of the processes are slots of `RareData`, which is freed first.
#[derive(Default)]
pub(crate) struct Browsers {
    chrome: Unreaped<chrome_process::ChromeProcess>,
    #[cfg(target_os = "macos")]
    host: Unreaped<host_process::HostProcess>,
}

impl Browsers {
    /// `PID` stays, so that the exit of the program still kills a host that a Worker has spawned.
    pub(crate) fn release_for_vm_teardown(&self) {
        if self.chrome.capacity() != 0 {
            removable_body_behind_value!(WebView, { drop(self.chrome.take()) });
        }
        #[cfg(target_os = "macos")]
        if self.host.capacity() != 0 {
            removable_body_behind_value!(WebView, { drop(self.host.take()) });
        }
    }
}

fn remove<T>(unreaped: &Unreaped<T>, this: *mut T) -> Option<AliasableBox<T>> {
    unreaped.with_taken(|unreaped| {
        let index = unreaped.iter().position(|other| other.as_ptr() == this)?;
        Some(unreaped.remove(index))
    })
}
