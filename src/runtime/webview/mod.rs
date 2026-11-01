//! WebView host-process management. macOS uses a `WKWebView`-backed host
//! subprocess; other platforms drive Chrome over the CDP
//! pipe. The C++ backends (WebKitBackend.cpp /
//! ChromeBackend.cpp) own the usockets client and frame protocol; this module
//! only spawns/watches the child.

#[path = "ChromeProcess.rs"]
pub(crate) mod chrome_process;
#[path = "HostProcess.rs"]
pub(crate) mod host_process;
