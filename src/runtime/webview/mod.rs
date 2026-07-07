//! WebView host-process management. macOS uses a `WKWebView`-backed host
//! subprocess; other platforms drive Chrome over the CDP
//! pipe. The C++ backends (WebKitBackend.cpp /
//! ChromeBackend.cpp) own the usockets client and frame protocol; this module
//! only spawns/watches the child.

#[path = "ChromeProcess.rs"]
pub mod chrome_process;
#[path = "HostProcess.rs"]
pub mod host_process;

pub use chrome_process::ChromeProcess;
pub use host_process::HostProcess;
