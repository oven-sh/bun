//! WebView host-process management. macOS uses a `WKWebView`-backed host
//! subprocess; other platforms drive Chrome over the CDP
//! pipe. The C++ backends (WebKitBackend.cpp /
//! ChromeBackend.cpp) own the usockets client and frame protocol; this module
//! only spawns/watches the child.

use bun_jsc::JsCell;
use bun_ptr::{OwnedThis, ThisPtr};

#[path = "ChromeProcess.rs"]
pub mod chrome_process;
#[path = "HostProcess.rs"]
pub mod host_process;

/// The browser host processes this (the main) thread spawned: at most one of
/// each kind is published to C++ at a time; a retired one (`bun test
/// --isolate`) stays here until its exit is reaped. Lives in the thread's
/// `RuntimeState` (`jsc_hooks::with_webview_hosts`).
#[derive(Default)]
pub(crate) struct Hosts {
    pub(crate) chrome: HostSlot<chrome_process::ChromeProcess>,
    pub(crate) webkit: HostSlot<host_process::HostProcess>,
}

/// One kind of host: the published instance and the retired ones whose exit
/// has not arrived yet. Owns them; their exit handlers get a `ThisPtr` back.
pub(crate) struct HostSlot<T> {
    current: JsCell<Option<OwnedThis<T>>>,
    retired: JsCell<Vec<OwnedThis<T>>>,
}

impl<T> Default for HostSlot<T> {
    fn default() -> Self {
        Self {
            current: JsCell::new(None),
            retired: JsCell::new(Vec::new()),
        }
    }
}

impl<T> HostSlot<T> {
    pub(crate) fn is_published(&self) -> bool {
        self.current.get().is_some()
    }

    /// The published host, if any.
    pub(crate) fn current(&self) -> Option<ThisPtr<T>> {
        self.current.get().as_ref().map(OwnedThis::this_ptr)
    }

    pub(crate) fn publish(&self, host: OwnedThis<T>) {
        debug_assert!(!self.is_published(), "a host is already published");
        self.current.set(Some(host));
    }

    /// Unpublish the current host but keep it until its exit ([`take`](Self::take)).
    pub(crate) fn retire(&self) -> Option<ThisPtr<T>> {
        let host = self.current.replace(None)?;
        let this = host.this_ptr();
        self.retired.with_mut(|retired| retired.push(host));
        Some(this)
    }

    /// Hand `this` host (published or retired) back to the caller.
    pub(crate) fn take(&self, this: ThisPtr<T>) -> Option<OwnedThis<T>> {
        let is = |host: &OwnedThis<T>| core::ptr::eq(host.this_ptr().as_ptr(), this.as_ptr());
        if self.current.get().as_ref().is_some_and(is) {
            return self.current.replace(None);
        }
        self.retired.with_mut(|retired| {
            let i = retired.iter().position(is)?;
            Some(retired.swap_remove(i))
        })
    }
}

impl<T> Drop for HostSlot<T> {
    /// VM teardown: the children were killed by
    /// `Bun__WebView__closeAllForTermination` and their exits can no longer be
    /// delivered here; leave the handles to process exit, as before.
    fn drop(&mut self) {
        let _ = core::mem::ManuallyDrop::new(self.current.replace(None));
        let _ = core::mem::ManuallyDrop::new(self.retired.replace(Vec::new()));
    }
}
