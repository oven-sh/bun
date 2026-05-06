//! WebView host-process management. macOS uses a `WKWebView`-backed host
//! subprocess (HostProcess.zig); other platforms drive Chrome over the CDP
//! pipe (ChromeProcess.zig). The C++ backends (WebKitBackend.cpp /
//! ChromeBackend.cpp) own the usockets client and frame protocol; this module
//! only spawns/watches the child.

#[path = "HostProcess.rs"]
pub mod host_process;
#[path = "ChromeProcess.rs"]
pub mod chrome_process;

pub use host_process::HostProcess;
pub use chrome_process::ChromeProcess;
