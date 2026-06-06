// bun-electron native shim — browser-process side.
// See shim.h for the C ABI contract and threading model.

#include "shim.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_command_line.h"
#include "include/cef_cookie.h"
#include "include/cef_devtools_message_observer.h"
#include "include/cef_image.h"
#include "include/cef_request.h"
#include "include/cef_request_context.h"
#include "include/cef_request_handler.h"
#include "include/cef_resource_handler.h"
#include "include/cef_resource_request_handler.h"
#include "include/cef_response.h"
#include "include/cef_scheme.h"
#include "include/views/cef_display.h"
#include "include/cef_parser.h"
#include "include/cef_registration.h"
#include "include/cef_values.h"
#include "include/cef_version.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"

#if !defined(_WIN32)
#include <fcntl.h>
#include <unistd.h>
#endif

#if defined(__APPLE__)
#include "include/wrapper/cef_library_loader.h"
// Defined in shim_mac.mm: installs an NSApplication subclass implementing
// CefAppProtocol before CEF initializes.
extern "C" void be_mac_init_application(void);
#endif

namespace {

// ---------------------------------------------------------------------------
// Small string utilities: kv parsing, percent decoding, JSON building.
// ---------------------------------------------------------------------------

int HexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

std::string PercentDecode(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  for (size_t i = 0; i < in.size(); i++) {
    if (in[i] == '%' && i + 2 < in.size()) {
      int hi = HexVal(in[i + 1]), lo = HexVal(in[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out.push_back(static_cast<char>((hi << 4) | lo));
        i += 2;
        continue;
      }
    }
    out.push_back(in[i]);
  }
  return out;
}

// Parses "key=value\n" lines; values are percent-decoded. Repeated keys are
// preserved in order.
using KVList = std::vector<std::pair<std::string, std::string>>;

KVList ParseKV(const char* kv) {
  KVList out;
  if (!kv) return out;
  const char* p = kv;
  while (*p) {
    const char* nl = strchr(p, '\n');
    std::string line = nl ? std::string(p, nl - p) : std::string(p);
    p = nl ? nl + 1 : p + line.size();
    if (line.empty()) continue;
    size_t eq = line.find('=');
    if (eq == std::string::npos) continue;
    out.emplace_back(line.substr(0, eq), PercentDecode(line.substr(eq + 1)));
  }
  return out;
}

std::string KVGet(const KVList& kv, const std::string& key,
                  const std::string& fallback = "") {
  for (auto& [k, v] : kv)
    if (k == key) return v;
  return fallback;
}

int KVGetInt(const KVList& kv, const std::string& key, int fallback) {
  std::string v = KVGet(kv, key);
  if (v.empty()) return fallback;
  return atoi(v.c_str());
}

bool KVGetBool(const KVList& kv, const std::string& key, bool fallback) {
  std::string v = KVGet(kv, key);
  if (v.empty()) return fallback;
  return v == "1" || v == "true";
}

void JsonEscapeTo(std::string& out, const std::string& s) {
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
}

// Tiny JSON object builder. Raw values (numbers, booleans, nested JSON) are
// added with AddRaw; strings are escaped via AddString.
class JsonObj {
 public:
  JsonObj& AddString(const char* key, const std::string& val) {
    Key(key);
    buf_ += '"';
    JsonEscapeTo(buf_, val);
    buf_ += '"';
    return *this;
  }
  JsonObj& AddRaw(const char* key, const std::string& raw) {
    Key(key);
    buf_ += raw.empty() ? "null" : raw;
    return *this;
  }
  JsonObj& AddInt(const char* key, int64_t v) {
    Key(key);
    buf_ += std::to_string(v);
    return *this;
  }
  JsonObj& AddBool(const char* key, bool v) {
    Key(key);
    buf_ += v ? "true" : "false";
    return *this;
  }
  std::string Build() const { return "{" + buf_ + "}"; }

 private:
  void Key(const char* key) {
    if (!buf_.empty()) buf_ += ',';
    buf_ += '"';
    buf_ += key;
    buf_ += "\":";
  }
  std::string buf_;
};

// ---------------------------------------------------------------------------
// Event queue: native -> JS.
// ---------------------------------------------------------------------------

std::mutex g_events_mutex;
std::vector<std::string> g_events;
#if !defined(_WIN32)
int g_event_pipe[2] = {-1, -1};
#endif

void EmitEvent(const std::string& json) {
  bool was_empty;
  {
    std::lock_guard<std::mutex> lock(g_events_mutex);
    was_empty = g_events.empty();
    g_events.push_back(json);
  }
#if !defined(_WIN32)
  if (was_empty && g_event_pipe[1] >= 0) {
    char b = 1;
    ssize_t rc = write(g_event_pipe[1], &b, 1);
    (void)rc;
  }
#else
  (void)was_empty;
#endif
}

void EmitWindowEvent(const char* type, int32_t window_id) {
  EmitEvent(
      JsonObj().AddString("type", type).AddInt("windowId", window_id).Build());
}

// ---------------------------------------------------------------------------
// Window registry. `state` mirrors UI-thread reality so the JS thread can
// answer synchronous getters (getBounds etc.) without blocking on the UI
// thread.
// ---------------------------------------------------------------------------

struct WindowState {
  int x = 0, y = 0, width = 800, height = 600;
  bool visible = false;
  bool focused = false;
  bool minimized = false;
  bool maximized = false;
  bool fullscreen = false;
  std::string title;
  std::string url;
};

struct WindowEntry {
  int32_t id = 0;
  KVList options;
  CefRefPtr<CefWindow> window;
  CefRefPtr<CefBrowserView> browser_view;
  CefRefPtr<CefBrowser> browser;
  CefRefPtr<CefRegistration> devtools_registration;
  std::map<int, int32_t> pending_captures;  // devtools message id -> capture id
  std::map<int, int32_t> pending_devtools;  // devtools message id -> call id
  WindowState state;
  bool destroyed = false;
};

std::mutex g_windows_mutex;
std::map<int32_t, std::shared_ptr<WindowEntry>> g_windows;
std::map<int, int32_t> g_browser_to_window;  // browser id -> window id

// webRequest.onBeforeRequest interception. Active only while a JS listener is
// registered, so the resource path stays zero-overhead otherwise. Declared
// here (before Client) because Client's resource methods reference it.
std::atomic<bool> g_web_request_active{false};
std::mutex g_web_request_mutex;
std::atomic<int32_t> g_next_web_request_id{1};
std::map<int32_t, CefRefPtr<CefCallback>> g_web_request_callbacks;
std::atomic<int32_t> g_next_window_id{1};
std::atomic<bool> g_external_pump{false};
std::atomic<bool> g_initialized{false};

std::shared_ptr<WindowEntry> FindWindow(int32_t id) {
  std::lock_guard<std::mutex> lock(g_windows_mutex);
  auto it = g_windows.find(id);
  return it == g_windows.end() ? nullptr : it->second;
}

// Live window options (mutable via be_window_command, e.g. set_resizable).
bool WindowOptBool(int32_t id, const std::string& key, bool fallback) {
  auto entry = FindWindow(id);
  if (!entry) return fallback;
  std::lock_guard<std::mutex> lock(g_windows_mutex);
  return KVGetBool(entry->options, key, fallback);
}

int WindowOptInt(int32_t id, const std::string& key, int fallback) {
  auto entry = FindWindow(id);
  if (!entry) return fallback;
  std::lock_guard<std::mutex> lock(g_windows_mutex);
  return KVGetInt(entry->options, key, fallback);
}

void SetWindowOpt(int32_t id, const std::string& key, const std::string& value) {
  auto entry = FindWindow(id);
  if (!entry) return;
  std::lock_guard<std::mutex> lock(g_windows_mutex);
  for (auto& [k, v] : entry->options) {
    if (k == key) {
      v = value;
      return;
    }
  }
  entry->options.emplace_back(key, value);
}

// ---------------------------------------------------------------------------
// Client: per-window CefClient with lifecycle/load/display/IPC handlers.
// ---------------------------------------------------------------------------

class Client : public CefClient,
               public CefLifeSpanHandler,
               public CefLoadHandler,
               public CefDisplayHandler,
               public CefRequestHandler,
               public CefResourceRequestHandler {
 public:
  explicit Client(int32_t window_id) : window_id_(window_id) {}

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

  // CefRequestHandler -> resource request handler (only when a webRequest
  // listener is active, to avoid per-request overhead otherwise).
  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(
      CefRefPtr<CefBrowser> browser,
      CefRefPtr<CefFrame> frame,
      CefRefPtr<CefRequest> request,
      bool is_navigation,
      bool is_download,
      const CefString& request_initiator,
      bool& disable_default_handling) override;

  // CefResourceRequestHandler
  cef_return_value_t OnBeforeResourceLoad(CefRefPtr<CefBrowser> browser,
                                          CefRefPtr<CefFrame> frame,
                                          CefRefPtr<CefRequest> request,
                                          CefRefPtr<CefCallback> callback) override;

  bool OnResourceResponse(CefRefPtr<CefBrowser> browser,
                          CefRefPtr<CefFrame> frame,
                          CefRefPtr<CefRequest> request,
                          CefRefPtr<CefResponse> response) override;

  void OnResourceLoadComplete(CefRefPtr<CefBrowser> browser,
                              CefRefPtr<CefFrame> frame,
                              CefRefPtr<CefRequest> request,
                              CefRefPtr<CefResponse> response,
                              cef_urlrequest_status_t status,
                              int64_t received_content_length) override;

  // Popups created by window.open() share the opener's CefClient, so the
  // owning window is resolved through the browser view's ID (assigned at
  // creation) rather than the constructor argument.
  int32_t WindowId(CefRefPtr<CefBrowser> browser) {
    if (browser) {
      CefRefPtr<CefBrowserView> view = CefBrowserView::GetForBrowser(browser);
      if (view) {
        int id = view->GetID();
        if (id > 0) return id;
      }
    }
    return window_id_;
  }

  // CefLifeSpanHandler
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser,
                     CefRefPtr<CefFrame> frame,
                     int popup_id,
                     const CefString& target_url,
                     const CefString& target_frame_name,
                     cef_window_open_disposition_t target_disposition,
                     bool user_gesture,
                     const CefPopupFeatures& popupFeatures,
                     CefWindowInfo& windowInfo,
                     CefRefPtr<CefClient>& client,
                     CefBrowserSettings& settings,
                     CefRefPtr<CefDictionaryValue>& extra_info,
                     bool* no_javascript_access) override;

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    CEF_REQUIRE_UI_THREAD();
    int32_t window_id = WindowId(browser);
    if (auto entry = FindWindow(window_id)) {
      entry->browser = browser;
    }
    {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      g_browser_to_window[browser->GetIdentifier()] = window_id;
    }
    EmitWindowEvent("browser-created", window_id);
  }

  bool DoClose(CefRefPtr<CefBrowser> browser) override {
    CEF_REQUIRE_UI_THREAD();
    EmitWindowEvent("close", WindowId(browser));
    // Allow the close to proceed; the views window closes with the browser.
    return false;
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    CEF_REQUIRE_UI_THREAD();
    if (auto entry = FindWindow(WindowId(browser))) {
      entry->browser = nullptr;
    }
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    g_browser_to_window.erase(browser->GetIdentifier());
  }

  // CefLoadHandler
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser,
                            bool isLoading,
                            bool canGoBack,
                            bool canGoForward) override {
    EmitEvent(JsonObj()
                  .AddString("type", "loading-state")
                  .AddInt("windowId", WindowId(browser))
                  .AddBool("isLoading", isLoading)
                  .AddBool("canGoBack", canGoBack)
                  .AddBool("canGoForward", canGoForward)
                  .Build());
  }

  void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                 CefRefPtr<CefFrame> frame,
                 int httpStatusCode) override {
    if (!frame->IsMain()) return;
    int32_t window_id = WindowId(browser);
    if (auto entry = FindWindow(window_id)) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      entry->state.url = frame->GetURL().ToString();
    }
    EmitEvent(JsonObj()
                  .AddString("type", "did-finish-load")
                  .AddInt("windowId", window_id)
                  .AddInt("httpStatus", httpStatusCode)
                  .Build());
  }

  void OnLoadError(CefRefPtr<CefBrowser> browser,
                   CefRefPtr<CefFrame> frame,
                   ErrorCode errorCode,
                   const CefString& errorText,
                   const CefString& failedUrl) override {
    if (!frame->IsMain() || errorCode == ERR_ABORTED) return;
    EmitEvent(JsonObj()
                  .AddString("type", "did-fail-load")
                  .AddInt("windowId", WindowId(browser))
                  .AddInt("errorCode", errorCode)
                  .AddString("errorText", errorText.ToString())
                  .AddString("url", failedUrl.ToString())
                  .Build());
  }

  // CefDisplayHandler
  void OnTitleChange(CefRefPtr<CefBrowser> browser,
                     const CefString& title) override {
    // Electron windows follow the page title by default. CEF reports the
    // URL as the "title" for pages without a <title>; keep the window title
    // in that case.
    std::string t = title.ToString();
    int32_t window_id = WindowId(browser);
    if (auto entry = FindWindow(window_id)) {
      bool is_url_fallback;
      {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        is_url_fallback = t == entry->state.url;
      }
      if (!is_url_fallback) {
        if (entry->window) entry->window->SetTitle(t);
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        entry->state.title = t;
      }
    }
    EmitEvent(JsonObj()
                  .AddString("type", "page-title-updated")
                  .AddInt("windowId", window_id)
                  .AddString("title", title.ToString())
                  .Build());
  }

  void OnAddressChange(CefRefPtr<CefBrowser> browser,
                       CefRefPtr<CefFrame> frame,
                       const CefString& url) override {
    if (!frame->IsMain()) return;
    int32_t window_id = WindowId(browser);
    if (auto entry = FindWindow(window_id)) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      entry->state.url = url.ToString();
    }
    EmitEvent(JsonObj()
                  .AddString("type", "address-changed")
                  .AddInt("windowId", window_id)
                  .AddString("url", url.ToString())
                  .Build());
  }

  bool OnConsoleMessage(CefRefPtr<CefBrowser> browser,
                        cef_log_severity_t level,
                        const CefString& message,
                        const CefString& source,
                        int line) override {
    EmitEvent(JsonObj()
                  .AddString("type", "console-message")
                  .AddInt("windowId", WindowId(browser))
                  .AddInt("level", level)
                  .AddString("message", message.ToString())
                  .AddString("source", source.ToString())
                  .AddInt("line", line)
                  .Build());
    return false;
  }

  // IPC from the renderer process.
  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override {
    const std::string name = message->GetName().ToString();
    CefRefPtr<CefListValue> args = message->GetArgumentList();
    int32_t window_id = WindowId(browser);
    if (name == "be-ipc") {
      EmitEvent(JsonObj()
                    .AddString("type", "ipc-message")
                    .AddInt("windowId", window_id)
                    .AddString("channel", args->GetString(0).ToString())
                    .AddRaw("args", args->GetString(1).ToString())
                    .Build());
      return true;
    }
    if (name == "be-invoke") {
      EmitEvent(JsonObj()
                    .AddString("type", "ipc-invoke")
                    .AddInt("windowId", window_id)
                    .AddInt("invokeId", args->GetInt(0))
                    .AddString("channel", args->GetString(1).ToString())
                    .AddRaw("args", args->GetString(2).ToString())
                    .Build());
      return true;
    }
    if (name == "be-eval-result") {
      EmitEvent(JsonObj()
                    .AddString("type", "eval-result")
                    .AddInt("windowId", window_id)
                    .AddInt("evalId", args->GetInt(0))
                    .AddRaw("result", args->GetString(1).ToString())
                    .AddBool("isError", args->GetBool(2))
                    .Build());
      return true;
    }
    return false;
  }

 private:
  const int32_t window_id_;
  IMPLEMENT_REFCOUNTING(Client);
};

// ---------------------------------------------------------------------------
// Views delegates.
// ---------------------------------------------------------------------------

// Window id allocated by Client::OnBeforePopup for the popup currently being
// created. The popup-creation callback chain runs on the UI thread, so a
// single slot suffices; consumed by OnPopupBrowserViewCreated regardless of
// which delegate instance receives that callback.
int32_t g_inflight_popup_window_id = 0;

void CreateTrackedPopupWindow(int32_t window_id,
                              CefRefPtr<CefBrowserView> opener_view,
                              CefRefPtr<CefBrowserView> popup_view);

class BrowserViewDelegate : public CefBrowserViewDelegate {
 public:
  explicit BrowserViewDelegate(int32_t window_id) : window_id_(window_id) {}

  cef_runtime_style_t GetBrowserRuntimeStyle() override {
    return CEF_RUNTIME_STYLE_ALLOY;
  }

  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> browser_view,
                                 CefRefPtr<CefBrowserView> popup_browser_view,
                                 bool is_devtools) override {
    int32_t popup_window_id = is_devtools ? 0 : g_inflight_popup_window_id;
    g_inflight_popup_window_id = 0;
    if (popup_window_id == 0) {
      // Wrap untracked popups (devtools) in a plain top-level window.
      class PopupWindowDelegate : public CefWindowDelegate {
       public:
        explicit PopupWindowDelegate(CefRefPtr<CefBrowserView> view)
            : view_(view) {}
        void OnWindowCreated(CefRefPtr<CefWindow> window) override {
          window->AddChildView(view_);
          window->Show();
        }
        cef_runtime_style_t GetWindowRuntimeStyle() override {
          return CEF_RUNTIME_STYLE_ALLOY;
        }

       private:
        CefRefPtr<CefBrowserView> view_;
        IMPLEMENT_REFCOUNTING(PopupWindowDelegate);
      };
      CefWindow::CreateTopLevelWindow(
          new PopupWindowDelegate(popup_browser_view));
      return true;
    }
    CreateTrackedPopupWindow(popup_window_id, browser_view, popup_browser_view);
    return true;
  }

 private:
  const int32_t window_id_;
  IMPLEMENT_REFCOUNTING(BrowserViewDelegate);
};

void UpdateCachedBounds(int32_t window_id, const CefRect& bounds) {
  if (auto entry = FindWindow(window_id)) {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->state.x = bounds.x;
    entry->state.y = bounds.y;
    entry->state.width = bounds.width;
    entry->state.height = bounds.height;
  }
}

class WindowDelegate : public CefWindowDelegate {
 public:
  WindowDelegate(int32_t window_id,
                 CefRefPtr<CefBrowserView> browser_view,
                 const KVList& options)
      : window_id_(window_id), browser_view_(browser_view), options_(options) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    if (auto entry = FindWindow(window_id_)) {
      entry->window = window;
    }
    window->AddChildView(browser_view_);

    std::string title = KVGet(options_, "title", "bun-electron");
    window->SetTitle(title);
    {
      if (auto entry = FindWindow(window_id_)) {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        entry->state.title = title;
      }
    }

    if (KVGetBool(options_, "always_on_top", false))
      window->SetAlwaysOnTop(true);

    if (KVGetBool(options_, "show", true)) {
      window->Show();
      if (auto entry = FindWindow(window_id_)) {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        entry->state.visible = true;
      }
    }

    if (KVGetBool(options_, "fullscreen", false)) window->SetFullscreen(true);

    UpdateCachedBounds(window_id_, window->GetBoundsInScreen());
    EmitWindowEvent("window-created", window_id_);
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    if (auto entry = FindWindow(window_id_)) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      entry->destroyed = true;
      entry->window = nullptr;
      entry->browser_view = nullptr;
    }
    EmitWindowEvent("closed", window_id_);
    {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      g_windows.erase(window_id_);
    }
  }

  void OnWindowActivationChanged(CefRefPtr<CefWindow> window,
                                 bool active) override {
    if (auto entry = FindWindow(window_id_)) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      entry->state.focused = active;
    }
    EmitWindowEvent(active ? "focus" : "blur", window_id_);
  }

  void OnWindowBoundsChanged(CefRefPtr<CefWindow> window,
                             const CefRect& new_bounds) override {
    bool size_changed, pos_changed;
    if (auto entry = FindWindow(window_id_)) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      size_changed = entry->state.width != new_bounds.width ||
                     entry->state.height != new_bounds.height;
      pos_changed =
          entry->state.x != new_bounds.x || entry->state.y != new_bounds.y;
      entry->state.x = new_bounds.x;
      entry->state.y = new_bounds.y;
      entry->state.width = new_bounds.width;
      entry->state.height = new_bounds.height;
      entry->state.maximized = window->IsMaximized();
      entry->state.minimized = window->IsMinimized();
    } else {
      return;
    }
    if (size_changed) EmitWindowEvent("resize", window_id_);
    if (pos_changed) EmitWindowEvent("move", window_id_);
  }

  void OnWindowFullscreenTransition(CefRefPtr<CefWindow> window,
                                    bool is_completed) override {
    if (!is_completed) return;
    bool fs = window->IsFullscreen();
    if (auto entry = FindWindow(window_id_)) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      entry->state.fullscreen = fs;
    }
    EmitEvent(JsonObj()
                  .AddString("type", "fullscreen")
                  .AddInt("windowId", window_id_)
                  .AddBool("fullscreen", fs)
                  .Build());
  }

  CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override {
    int w = KVGetInt(options_, "width", 800);
    int h = KVGetInt(options_, "height", 600);
    int x = KVGetInt(options_, "x", -1);
    int y = KVGetInt(options_, "y", -1);
    // x/y of -1 means "use the platform default placement".
    if (x < 0 || y < 0) {
      return CefRect(0, 0, w, h);
    }
    return CefRect(x, y, w, h);
  }

  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override {
    if (KVGetBool(options_, "fullscreen", false))
      return CEF_SHOW_STATE_FULLSCREEN;
    return CEF_SHOW_STATE_NORMAL;
  }

  bool IsFrameless(CefRefPtr<CefWindow> window) override {
    return KVGetBool(options_, "frameless", false);
  }

  // These read the live entry options so set_resizable & co. take effect
  // after creation.
  bool CanResize(CefRefPtr<CefWindow> window) override {
    return WindowOptBool(window_id_, "resizable", true);
  }

  bool CanMaximize(CefRefPtr<CefWindow> window) override {
    return WindowOptBool(window_id_, "maximizable", true) &&
           WindowOptBool(window_id_, "resizable", true);
  }

  bool CanMinimize(CefRefPtr<CefWindow> window) override {
    return WindowOptBool(window_id_, "minimizable", true);
  }

  CefSize GetMinimumSize(CefRefPtr<CefView> view) override {
    return CefSize(WindowOptInt(window_id_, "min_width", 0),
                   WindowOptInt(window_id_, "min_height", 0));
  }

  CefSize GetMaximumSize(CefRefPtr<CefView> view) override {
    return CefSize(WindowOptInt(window_id_, "max_width", 0),
                   WindowOptInt(window_id_, "max_height", 0));
  }

  bool CanClose(CefRefPtr<CefWindow> window) override {
    // Mirror the cefsimple pattern: ask the browser first so unload handlers
    // run; TryCloseBrowser() returns true when it is safe to close.
    CefRefPtr<CefBrowser> browser = browser_view_->GetBrowser();
    if (browser) return browser->GetHost()->TryCloseBrowser();
    return true;
  }

  cef_runtime_style_t GetWindowRuntimeStyle() override {
    return CEF_RUNTIME_STYLE_ALLOY;
  }

 private:
  const int32_t window_id_;
  CefRefPtr<CefBrowserView> browser_view_;
  const KVList options_;
  IMPLEMENT_REFCOUNTING(WindowDelegate);
};

// webRequest interception: when a listener is active, every resource load is
// announced to JS, which decides allow/cancel and calls be_web_request_continue.
CefRefPtr<CefResourceRequestHandler> Client::GetResourceRequestHandler(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefRequest> request,
    bool is_navigation,
    bool is_download,
    const CefString& request_initiator,
    bool& disable_default_handling) {
  return g_web_request_active.load() ? this : nullptr;
}

cef_return_value_t Client::OnBeforeResourceLoad(CefRefPtr<CefBrowser> browser,
                                                CefRefPtr<CefFrame> frame,
                                                CefRefPtr<CefRequest> request,
                                                CefRefPtr<CefCallback> callback) {
  if (!g_web_request_active.load()) return RV_CONTINUE;
  int32_t req_id = g_next_web_request_id.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(g_web_request_mutex);
    g_web_request_callbacks[req_id] = callback;
  }
  const char* rt = "other";
  switch (request->GetResourceType()) {
    case RT_MAIN_FRAME: rt = "mainFrame"; break;
    case RT_SUB_FRAME: rt = "subFrame"; break;
    case RT_STYLESHEET: rt = "stylesheet"; break;
    case RT_SCRIPT: rt = "script"; break;
    case RT_IMAGE: rt = "image"; break;
    case RT_FONT_RESOURCE: rt = "font"; break;
    case RT_XHR: rt = "xhr"; break;
    default: rt = "other";
  }
  EmitEvent(JsonObj()
                .AddString("type", "web-request-before")
                .AddInt("requestId", req_id)
                .AddInt("windowId", WindowId(browser))
                .AddString("url", request->GetURL().ToString())
                .AddString("method", request->GetMethod().ToString())
                .AddString("resourceType", rt)
                .Build());
  return RV_CONTINUE_ASYNC;
}

bool Client::OnResourceResponse(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefRefPtr<CefRequest> request,
                                CefRefPtr<CefResponse> response) {
  if (!g_web_request_active.load()) return false;
  // headers-received: observational (we don't rewrite headers here).
  std::string headers = "{";
  CefResponse::HeaderMap map;
  response->GetHeaderMap(map);
  bool first = true;
  for (auto& [k, v] : map) {
    if (!first) headers += ',';
    first = false;
    headers += '"';
    JsonEscapeTo(headers, k.ToString());
    headers += "\":\"";
    JsonEscapeTo(headers, v.ToString());
    headers += '"';
  }
  headers += '}';
  EmitEvent(JsonObj()
                .AddString("type", "web-request-headers")
                .AddInt("windowId", WindowId(browser))
                .AddString("url", request->GetURL().ToString())
                .AddInt("statusCode", response->GetStatus())
                .AddRaw("headers", headers)
                .Build());
  return false;
}

void Client::OnResourceLoadComplete(CefRefPtr<CefBrowser> browser,
                                    CefRefPtr<CefFrame> frame,
                                    CefRefPtr<CefRequest> request,
                                    CefRefPtr<CefResponse> response,
                                    cef_urlrequest_status_t status,
                                    int64_t received_content_length) {
  if (!g_web_request_active.load()) return;
  const bool ok = status == UR_SUCCESS;
  EmitEvent(JsonObj()
                .AddString("type", ok ? "web-request-completed" : "web-request-error")
                .AddInt("windowId", WindowId(browser))
                .AddString("url", request->GetURL().ToString())
                .AddInt("statusCode", response ? response->GetStatus() : 0)
                .AddInt("contentLength", static_cast<int64_t>(received_content_length))
                .Build());
}

// window.open() popups: allocate the window entry and give the popup its own
// Client so events are attributed correctly from the first callback.
bool Client::OnBeforePopup(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           int popup_id,
                           const CefString& target_url,
                           const CefString& target_frame_name,
                           cef_window_open_disposition_t target_disposition,
                           bool user_gesture,
                           const CefPopupFeatures& popupFeatures,
                           CefWindowInfo& windowInfo,
                           CefRefPtr<CefClient>& client,
                           CefBrowserSettings& settings,
                           CefRefPtr<CefDictionaryValue>& extra_info,
                           bool* no_javascript_access) {
  CEF_REQUIRE_UI_THREAD();
  int32_t id = g_next_window_id.fetch_add(1);
  auto entry = std::make_shared<WindowEntry>();
  entry->id = id;
  entry->options.emplace_back("show", "1");
  if (popupFeatures.widthSet)
    entry->options.emplace_back("width", std::to_string(popupFeatures.width));
  if (popupFeatures.heightSet)
    entry->options.emplace_back("height", std::to_string(popupFeatures.height));
  entry->state.url = target_url.ToString();
  {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    g_windows[id] = entry;
  }
  client = new Client(id);
  g_inflight_popup_window_id = id;
  return false;  // allow the popup
}

void CreateTrackedPopupWindow(int32_t window_id,
                              CefRefPtr<CefBrowserView> opener_view,
                              CefRefPtr<CefBrowserView> popup_view) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry) return;
  popup_view->SetID(window_id);
  entry->browser_view = popup_view;
  std::string url;
  {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    url = entry->state.url;
  }
  EmitEvent(JsonObj()
                .AddString("type", "window-open")
                .AddInt("windowId", window_id)
                .AddInt("openerId", opener_view ? opener_view->GetID() : 0)
                .AddString("url", url)
                .Build());
  CefWindow::CreateTopLevelWindow(
      new WindowDelegate(window_id, popup_view, entry->options));
}

// ---------------------------------------------------------------------------
// capturePage via the DevTools protocol (Page.captureScreenshot).
// ---------------------------------------------------------------------------

class CaptureObserver : public CefDevToolsMessageObserver {
 public:
  explicit CaptureObserver(int32_t window_id) : window_id_(window_id) {}

  void OnDevToolsMethodResult(CefRefPtr<CefBrowser> browser,
                              int message_id,
                              bool success,
                              const void* result,
                              size_t result_size) override {
    auto entry = FindWindow(window_id_);
    if (!entry) return;
    std::string json(static_cast<const char*>(result), result_size);

    int32_t capture_id = 0, devtools_id = 0;
    {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      auto cit = entry->pending_captures.find(message_id);
      if (cit != entry->pending_captures.end()) {
        capture_id = cit->second;
        entry->pending_captures.erase(cit);
      }
      auto dit = entry->pending_devtools.find(message_id);
      if (dit != entry->pending_devtools.end()) {
        devtools_id = dit->second;
        entry->pending_devtools.erase(dit);
      }
    }
    if (capture_id) {
      EmitEvent(JsonObj()
                    .AddString("type", "capture-result")
                    .AddInt("windowId", window_id_)
                    .AddInt("captureId", capture_id)
                    .AddBool("success", success)
                    .AddRaw("result", json.empty() ? "null" : json)
                    .Build());
    } else if (devtools_id) {
      EmitEvent(JsonObj()
                    .AddString("type", "devtools-result")
                    .AddInt("windowId", window_id_)
                    .AddInt("callId", devtools_id)
                    .AddBool("success", success)
                    .AddRaw("result", json.empty() ? "null" : json)
                    .Build());
    }
  }

 private:
  const int32_t window_id_;
  IMPLEMENT_REFCOUNTING(CaptureObserver);
};

void CapturePageOnUI(int32_t window_id, int32_t capture_id) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry || !entry->browser) {
    EmitEvent(JsonObj()
                  .AddString("type", "capture-result")
                  .AddInt("windowId", window_id)
                  .AddInt("captureId", capture_id)
                  .AddBool("success", false)
                  .AddRaw("result", "{\"message\":\"window destroyed\"}")
                  .Build());
    return;
  }
  CefRefPtr<CefBrowserHost> host = entry->browser->GetHost();
  if (!entry->devtools_registration) {
    entry->devtools_registration =
        host->AddDevToolsMessageObserver(new CaptureObserver(window_id));
  }
  CefRefPtr<CefDictionaryValue> params = CefDictionaryValue::Create();
  params->SetString("format", "png");
  int message_id = host->ExecuteDevToolsMethod(0, "Page.captureScreenshot", params);
  if (message_id > 0) {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->pending_captures[message_id] = capture_id;
  } else {
    EmitEvent(JsonObj()
                  .AddString("type", "capture-result")
                  .AddInt("windowId", window_id)
                  .AddInt("captureId", capture_id)
                  .AddBool("success", false)
                  .AddRaw("result", "{\"message\":\"devtools method failed\"}")
                  .Build());
  }
}

void DevToolsMethodOnUI(int32_t window_id,
                        int32_t call_id,
                        std::string method,
                        std::string params_json) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry || !entry->browser) {
    EmitEvent(JsonObj()
                  .AddString("type", "devtools-result")
                  .AddInt("windowId", window_id)
                  .AddInt("callId", call_id)
                  .AddBool("success", false)
                  .AddRaw("result", "{\"message\":\"window destroyed\"}")
                  .Build());
    return;
  }
  CefRefPtr<CefBrowserHost> host = entry->browser->GetHost();
  if (!entry->devtools_registration) {
    entry->devtools_registration =
        host->AddDevToolsMessageObserver(new CaptureObserver(window_id));
  }
  CefRefPtr<CefDictionaryValue> params;
  if (!params_json.empty()) {
    CefRefPtr<CefValue> v = CefParseJSON(params_json, JSON_PARSER_RFC);
    if (v && v->GetType() == VTYPE_DICTIONARY) params = v->GetDictionary();
  }
  int message_id = host->ExecuteDevToolsMethod(0, method, params);
  if (message_id > 0) {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->pending_devtools[message_id] = call_id;
  } else {
    EmitEvent(JsonObj()
                  .AddString("type", "devtools-result")
                  .AddInt("windowId", window_id)
                  .AddInt("callId", call_id)
                  .AddBool("success", false)
                  .AddRaw("result", "{\"message\":\"devtools method failed\"}")
                  .Build());
  }
}

// ---------------------------------------------------------------------------
// Custom-scheme resource handling: backs ipcRenderer.sendSync (scheme
// "beipc", sync XHR from the renderer answered asynchronously here) and the
// protocol module (user schemes handled by JS).
// ---------------------------------------------------------------------------

std::vector<std::string> g_custom_schemes;  // user schemes from init kv

std::mutex g_resources_mutex;
std::atomic<int32_t> g_next_resource_id{1};

// Origins the app explicitly loaded (via loadURL) are trusted to read
// sendSync replies. "null" (data:/sandboxed) and "file://" local content are
// always allowed since the app authored them. Anything navigated to by page
// content (e.g. a remote site reached via a link) is NOT in this set, so its
// sendSync replies are not cross-origin readable.
std::mutex g_ipc_origins_mutex;
std::set<std::string> g_ipc_allowed_origins;

bool IsAllowedIpcOrigin(const std::string& origin) {
  if (origin.empty() || origin == "null" || origin == "file://") return true;
  std::lock_guard<std::mutex> lock(g_ipc_origins_mutex);
  return g_ipc_allowed_origins.count(origin) > 0;
}

class PendingResourceHandler;
std::map<int32_t, CefRefPtr<PendingResourceHandler>> g_pending_resources;

class PendingResourceHandler : public CefResourceHandler {
 public:
  PendingResourceHandler(int32_t window_id, std::string scheme, bool is_sync_ipc)
      : window_id_(window_id), scheme_(std::move(scheme)), is_sync_ipc_(is_sync_ipc) {}

  bool Open(CefRefPtr<CefRequest> request,
            bool& handle_request,
            CefRefPtr<CefCallback> callback) override {
    handle_request = false;
    callback_ = callback;
    id_ = g_next_resource_id.fetch_add(1);
    request_origin_ = request->GetHeaderByName("Origin").ToString();
    {
      std::lock_guard<std::mutex> lock(g_resources_mutex);
      g_pending_resources[id_] = this;
    }

    std::string body;
    CefRefPtr<CefPostData> post = request->GetPostData();
    if (post) {
      CefPostData::ElementVector elements;
      post->GetElements(elements);
      for (auto& el : elements) {
        if (el->GetType() != PDE_TYPE_BYTES) continue;
        size_t size = el->GetBytesCount();
        std::string chunk(size, '\0');
        el->GetBytes(size, chunk.data());
        body += chunk;
      }
    }

    CefRefPtr<CefBinaryValue> body_bin;
    std::string body_b64;
    if (!body.empty()) {
      body_b64 = CefBase64Encode(body.data(), body.size()).ToString();
    }

    EmitEvent(JsonObj()
                  .AddString("type", is_sync_ipc_ ? "ipc-sync" : "protocol-request")
                  .AddInt("windowId", window_id_)
                  .AddInt("resourceId", id_)
                  .AddString("scheme", scheme_)
                  .AddString("url", request->GetURL().ToString())
                  .AddString("method", request->GetMethod().ToString())
                  .AddString("body", body_b64)
                  .Build());
    return true;
  }

  void Resolve(int status, const std::string& mime, std::string body) {
    status_ = status;
    mime_ = mime;
    body_ = std::move(body);
    if (callback_) callback_->Continue();
  }

  void GetResponseHeaders(CefRefPtr<CefResponse> response,
                          int64_t& response_length,
                          CefString& redirectUrl) override {
    response->SetStatus(status_);
    response->SetMimeType(mime_.empty() ? "application/json" : mime_);
    // The internal sendSync channel (beipc) is reached cross-origin by the
    // app's own renderer, so it needs CORS to read the response — but reflect
    // the caller's exact origin rather than using a wildcard, so no other
    // origin can read replies. User protocol schemes set their own headers
    // (via the JS handler's Response); we don't inject CORS for them.
    if (is_sync_ipc_ && IsAllowedIpcOrigin(request_origin_) &&
        !request_origin_.empty()) {
      CefResponse::HeaderMap headers;
      response->GetHeaderMap(headers);
      headers.insert({"Access-Control-Allow-Origin", request_origin_});
      headers.insert({"Vary", "Origin"});
      response->SetHeaderMap(headers);
    }
    response_length = static_cast<int64_t>(body_.size());
  }

  bool Read(void* data_out,
            int bytes_to_read,
            int& bytes_read,
            CefRefPtr<CefResourceReadCallback> callback) override {
    if (offset_ >= body_.size()) {
      bytes_read = 0;
      return false;
    }
    size_t n = std::min(static_cast<size_t>(bytes_to_read), body_.size() - offset_);
    memcpy(data_out, body_.data() + offset_, n);
    offset_ += n;
    bytes_read = static_cast<int>(n);
    return true;
  }

  void Cancel() override {
    std::lock_guard<std::mutex> lock(g_resources_mutex);
    g_pending_resources.erase(id_);
  }

 private:
  const int32_t window_id_;
  const std::string scheme_;
  const bool is_sync_ipc_;
  int32_t id_ = 0;
  CefRefPtr<CefCallback> callback_;
  int status_ = 200;
  std::string mime_;
  std::string body_;
  std::string request_origin_;
  size_t offset_ = 0;
  IMPLEMENT_REFCOUNTING(PendingResourceHandler);
};

class SchemeFactory : public CefSchemeHandlerFactory {
 public:
  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser,
                                       CefRefPtr<CefFrame> frame,
                                       const CefString& scheme_name,
                                       CefRefPtr<CefRequest> request) override {
    int32_t window_id = 0;
    if (browser) {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      auto it = g_browser_to_window.find(browser->GetIdentifier());
      if (it != g_browser_to_window.end()) window_id = it->second;
    }
    std::string scheme = scheme_name.ToString();
    return new PendingResourceHandler(window_id, scheme, scheme == "beipc");
  }

  IMPLEMENT_REFCOUNTING(SchemeFactory);
};

// ---------------------------------------------------------------------------
// File dialogs, cookies, screen info.
// ---------------------------------------------------------------------------

class FileDialogCallback : public CefRunFileDialogCallback {
 public:
  FileDialogCallback(int32_t window_id, int32_t dialog_id)
      : window_id_(window_id), dialog_id_(dialog_id) {}

  void OnFileDialogDismissed(const std::vector<CefString>& file_paths) override {
    std::string paths = "[";
    for (size_t i = 0; i < file_paths.size(); i++) {
      if (i) paths += ',';
      paths += '"';
      JsonEscapeTo(paths, file_paths[i].ToString());
      paths += '"';
    }
    paths += ']';
    EmitEvent(JsonObj()
                  .AddString("type", "file-dialog-result")
                  .AddInt("windowId", window_id_)
                  .AddInt("dialogId", dialog_id_)
                  .AddBool("canceled", file_paths.empty())
                  .AddRaw("paths", paths)
                  .Build());
  }

 private:
  const int32_t window_id_;
  const int32_t dialog_id_;
  IMPLEMENT_REFCOUNTING(FileDialogCallback);
};

void RunFileDialogOnUI(int32_t window_id, int32_t dialog_id, std::string kv_str) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry || !entry->browser) {
    EmitEvent(JsonObj()
                  .AddString("type", "file-dialog-result")
                  .AddInt("windowId", window_id)
                  .AddInt("dialogId", dialog_id)
                  .AddBool("canceled", true)
                  .AddRaw("paths", "[]")
                  .Build());
    return;
  }
  KVList kv = ParseKV(kv_str.c_str());
  std::string mode_str = KVGet(kv, "mode", "open");
  cef_file_dialog_mode_t mode = FILE_DIALOG_OPEN;
  if (mode_str == "save") mode = FILE_DIALOG_SAVE;
  else if (mode_str == "open-multiple") mode = FILE_DIALOG_OPEN_MULTIPLE;
  else if (mode_str == "open-folder") mode = FILE_DIALOG_OPEN_FOLDER;

  std::vector<CefString> filters;
  for (auto& [k, v] : kv) {
    if (k == "filter") filters.push_back(v);
  }
  entry->browser->GetHost()->RunFileDialog(
      mode, KVGet(kv, "title"), KVGet(kv, "default_path"), filters,
      new FileDialogCallback(window_id, dialog_id));
}

class CookieCollector : public CefCookieVisitor {
 public:
  explicit CookieCollector(int32_t op_id) : op_id_(op_id) {}

  bool Visit(const CefCookie& cookie, int count, int total, bool& deleteCookie) override {
    if (!cookies_.empty()) cookies_ += ',';
    cookies_ += JsonObj()
                    .AddString("name", CefString(&cookie.name).ToString())
                    .AddString("value", CefString(&cookie.value).ToString())
                    .AddString("domain", CefString(&cookie.domain).ToString())
                    .AddString("path", CefString(&cookie.path).ToString())
                    .AddBool("secure", cookie.secure != 0)
                    .AddBool("httpOnly", cookie.httponly != 0)
                    .Build();
    return true;
  }

  ~CookieCollector() override {
    EmitEvent(JsonObj()
                  .AddString("type", "cookies-result")
                  .AddInt("opId", op_id_)
                  .AddBool("success", true)
                  .AddRaw("cookies", "[" + cookies_ + "]")
                  .Build());
  }

 private:
  const int32_t op_id_;
  std::string cookies_;
  IMPLEMENT_REFCOUNTING(CookieCollector);
};

class CookieDone : public CefSetCookieCallback, public CefDeleteCookiesCallback {
 public:
  explicit CookieDone(int32_t op_id) : op_id_(op_id) {}

  void OnComplete(bool success) override {
    EmitEvent(JsonObj()
                  .AddString("type", "cookies-result")
                  .AddInt("opId", op_id_)
                  .AddBool("success", success)
                  .AddRaw("cookies", "[]")
                  .Build());
  }

  void OnComplete(int num_deleted) override {
    EmitEvent(JsonObj()
                  .AddString("type", "cookies-result")
                  .AddInt("opId", op_id_)
                  .AddBool("success", true)
                  .AddRaw("cookies", "[]")
                  .Build());
  }

 private:
  const int32_t op_id_;
  IMPLEMENT_REFCOUNTING(CookieDone);
};

// Per-partition request contexts (UI-thread only). "" => global context.
std::map<std::string, CefRefPtr<CefRequestContext>> g_partition_contexts;

CefRefPtr<CefRequestContext> PartitionContext(const std::string& partition) {
  CEF_REQUIRE_UI_THREAD();
  if (partition.empty()) return CefRequestContext::GetGlobalContext();
  auto it = g_partition_contexts.find(partition);
  if (it != g_partition_contexts.end()) return it->second;
  CefRequestContextSettings settings;
  // "persist:" partitions get on-disk storage; others are in-memory.
  CefRefPtr<CefRequestContext> ctx =
      CefRequestContext::CreateContext(settings, nullptr);
  g_partition_contexts[partition] = ctx;
  return ctx;
}

void CookiesOpOnUI(int32_t op_id, std::string op, std::string kv_str) {
  CEF_REQUIRE_UI_THREAD();
  KVList kv = ParseKV(kv_str.c_str());
  CefRefPtr<CefRequestContext> ctx = PartitionContext(KVGet(kv, "partition"));
  CefRefPtr<CefCookieManager> manager =
      ctx ? ctx->GetCookieManager(nullptr) : CefCookieManager::GetGlobalManager(nullptr);
  if (!manager) {
    EmitEvent(JsonObj()
                  .AddString("type", "cookies-result")
                  .AddInt("opId", op_id)
                  .AddBool("success", false)
                  .AddRaw("cookies", "[]")
                  .Build());
    return;
  }
  if (op == "set") {
    CefCookie cookie;
    CefString(&cookie.name) = KVGet(kv, "name");
    CefString(&cookie.value) = KVGet(kv, "value");
    CefString(&cookie.domain) = KVGet(kv, "domain");
    CefString(&cookie.path) = KVGet(kv, "path", "/");
    cookie.secure = KVGetBool(kv, "secure", false);
    cookie.httponly = KVGetBool(kv, "httpOnly", false);
    manager->SetCookie(KVGet(kv, "url"), cookie, new CookieDone(op_id));
  } else if (op == "get") {
    std::string url = KVGet(kv, "url");
    CefRefPtr<CefCookieVisitor> visitor = new CookieCollector(op_id);
    if (url.empty()) {
      manager->VisitAllCookies(visitor);
    } else {
      manager->VisitUrlCookies(url, true, visitor);
    }
  } else if (op == "remove") {
    manager->DeleteCookies(KVGet(kv, "url"), KVGet(kv, "name"), new CookieDone(op_id));
  }
}

std::string ScreenInfoJson() {
  CEF_REQUIRE_UI_THREAD();
  std::vector<CefRefPtr<CefDisplay>> displays;
  CefDisplay::GetAllDisplays(displays);
  CefRefPtr<CefDisplay> primary = CefDisplay::GetPrimaryDisplay();
  std::string out = "[";
  for (size_t i = 0; i < displays.size(); i++) {
    CefRect bounds = displays[i]->GetBounds();
    CefRect work = displays[i]->GetWorkArea();
    if (i) out += ',';
    JsonObj rect;
    out += JsonObj()
               .AddInt("id", displays[i]->GetID())
               .AddBool("primary", primary && displays[i]->GetID() == primary->GetID())
               .AddRaw("bounds", JsonObj()
                                     .AddInt("x", bounds.x)
                                     .AddInt("y", bounds.y)
                                     .AddInt("width", bounds.width)
                                     .AddInt("height", bounds.height)
                                     .Build())
               .AddRaw("workArea", JsonObj()
                                       .AddInt("x", work.x)
                                       .AddInt("y", work.y)
                                       .AddInt("width", work.width)
                                       .AddInt("height", work.height)
                                       .Build())
               .AddRaw("scaleFactor", std::to_string(displays[i]->GetDeviceScaleFactor()))
               .Build();
  }
  out += ']';
  return out;
}

// ---------------------------------------------------------------------------
// App: browser-process CefApp.
// ---------------------------------------------------------------------------

std::vector<std::string> g_extra_switches;

class App : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }

  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) override {
    const int options = CEF_SCHEME_OPTION_STANDARD | CEF_SCHEME_OPTION_SECURE |
                        CEF_SCHEME_OPTION_CORS_ENABLED |
                        CEF_SCHEME_OPTION_FETCH_ENABLED;
    registrar->AddCustomScheme("beipc", options);
    for (const auto& scheme : g_custom_schemes) {
      registrar->AddCustomScheme(scheme, options);
    }
  }

  void OnBeforeChildProcessLaunch(CefRefPtr<CefCommandLine> command_line) override {
    // The helper registers the same schemes; ship the list on its command
    // line (scheme registration must match across processes).
    std::string joined = "beipc";
    for (const auto& scheme : g_custom_schemes) joined += "," + scheme;
    command_line->AppendSwitchWithValue("be-custom-schemes", joined);
  }

  void OnBeforeCommandLineProcessing(
      const CefString& process_type,
      CefRefPtr<CefCommandLine> command_line) override {
    for (const auto& sw : g_extra_switches) {
      size_t eq = sw.find('=');
      if (eq == std::string::npos) {
        command_line->AppendSwitch(sw);
      } else {
        command_line->AppendSwitchWithValue(sw.substr(0, eq),
                                            sw.substr(eq + 1));
      }
    }
  }

  void OnContextInitialized() override {
    CEF_REQUIRE_UI_THREAD();
    CefRegisterSchemeHandlerFactory("beipc", "", new SchemeFactory());
    for (const auto& scheme : g_custom_schemes) {
      CefRegisterSchemeHandlerFactory(scheme, "", new SchemeFactory());
    }
    EmitEvent(JsonObj().AddString("type", "ready").Build());
  }

  void OnScheduleMessagePumpWork(int64_t delay_ms) override {
    if (!g_external_pump.load()) return;
    EmitEvent(JsonObj()
                  .AddString("type", "pump-schedule")
                  .AddInt("delayMs", delay_ms)
                  .Build());
  }

  IMPLEMENT_REFCOUNTING(App);
};

CefRefPtr<App> g_app;

// ---------------------------------------------------------------------------
// UI-thread tasks for window creation/commands.
// ---------------------------------------------------------------------------

void CreateWindowOnUI(int32_t window_id) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry) return;

  CefBrowserSettings browser_settings;
  std::string bg = KVGet(entry->options, "background_color");
  if (!bg.empty()) {
    browser_settings.background_color =
        static_cast<cef_color_t>(strtoul(bg.c_str(), nullptr, 16));
  }

  // No default URL: with an empty URL the browser performs no initial
  // navigation, so did-finish-load only ever fires for explicit loads.
  std::string url = KVGet(entry->options, "url");
  CefRefPtr<CefClient> client = new Client(window_id);

  // Preload source rides to the render process via extra_info; the helper
  // executes it in every new main-frame context (renderer_bootstrap runs
  // first so ipcRenderer/contextBridge are available to it).
  CefRefPtr<CefDictionaryValue> extra_info;
  std::string preload = KVGet(entry->options, "preload");
  bool context_isolation = KVGetBool(entry->options, "context_isolation", false);
  if (!preload.empty() || context_isolation) {
    extra_info = CefDictionaryValue::Create();
    if (!preload.empty()) extra_info->SetString("preload", preload);
    extra_info->SetBool("context_isolation", context_isolation);
  }

  CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
      client, url, browser_settings, extra_info, nullptr,
      new BrowserViewDelegate(window_id));
  browser_view->SetID(window_id);
  entry->browser_view = browser_view;

  CefWindow::CreateTopLevelWindow(
      new WindowDelegate(window_id, browser_view, entry->options));
}

void WindowCommandOnUI(int32_t window_id, std::string cmd, std::string arg) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry) return;
  CefRefPtr<CefWindow> window = entry->window;
  CefRefPtr<CefBrowser> browser = entry->browser;

  auto set_visible = [&](bool v) {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->state.visible = v;
  };

  if (cmd == "show" && window) {
    window->Show();
    set_visible(true);
  } else if (cmd == "hide" && window) {
    window->Hide();
    set_visible(false);
  } else if (cmd == "close" && window) {
    window->Close();
  } else if (cmd == "destroy") {
    // Force-close without asking the renderer.
    if (browser) browser->GetHost()->CloseBrowser(true);
    if (window && !window->IsClosed()) window->Close();
  } else if (cmd == "focus" && window) {
    window->Activate();
  } else if (cmd == "minimize" && window) {
    window->Minimize();
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->state.minimized = true;
  } else if (cmd == "maximize" && window) {
    window->Maximize();
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->state.maximized = true;
  } else if (cmd == "restore" && window) {
    window->Restore();
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->state.minimized = false;
    entry->state.maximized = false;
  } else if (cmd == "center" && window) {
    CefRect b = window->GetBoundsInScreen();
    window->CenterWindow(CefSize(b.width, b.height));
  } else if (cmd == "set_title" && window) {
    window->SetTitle(arg);
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    entry->state.title = arg;
  } else if (cmd == "set_bounds" && window) {
    KVList kv = ParseKV(arg.c_str());
    CefRect b = window->GetBoundsInScreen();
    b.x = KVGetInt(kv, "x", b.x);
    b.y = KVGetInt(kv, "y", b.y);
    b.width = KVGetInt(kv, "width", b.width);
    b.height = KVGetInt(kv, "height", b.height);
    window->SetBounds(b);
  } else if (cmd == "set_fullscreen" && window) {
    window->SetFullscreen(arg == "1");
  } else if (cmd == "set_always_on_top" && window) {
    window->SetAlwaysOnTop(arg == "1");
  } else if (cmd == "load_url" && browser) {
    browser->GetMainFrame()->LoadURL(arg);
  } else if (cmd == "open_devtools" && browser) {
    CefWindowInfo wi;
    CefBrowserSettings bs;
    browser->GetHost()->ShowDevTools(wi, nullptr, bs, CefPoint());
  } else if (cmd == "close_devtools" && browser) {
    browser->GetHost()->CloseDevTools();
  } else if (cmd == "reload" && browser) {
    browser->Reload();
  } else if (cmd == "stop" && browser) {
    browser->StopLoad();
  } else if (cmd == "go_back" && browser) {
    browser->GoBack();
  } else if (cmd == "go_forward" && browser) {
    browser->GoForward();
  } else if (cmd == "set_zoom" && browser) {
    browser->GetHost()->SetZoomLevel(atof(arg.c_str()));
  } else if (cmd == "set_audio_muted" && browser) {
    browser->GetHost()->SetAudioMuted(arg == "1");
  } else if (cmd == "set_resizable" || cmd == "set_minimizable" ||
             cmd == "set_maximizable") {
    SetWindowOpt(window_id, cmd.substr(4), arg == "1" ? "1" : "0");
  } else if (cmd == "set_icon" && window) {
    CefRefPtr<CefBinaryValue> png = CefBase64Decode(arg);
    if (png) {
      std::vector<unsigned char> bytes(png->GetSize());
      png->GetData(bytes.data(), bytes.size(), 0);
      CefRefPtr<CefImage> image = CefImage::CreateImage();
      if (image && image->AddPNG(1.0f, bytes.data(), bytes.size())) {
        window->SetWindowIcon(image);
        window->SetWindowAppIcon(image);
      }
    }
  } else if (cmd == "set_min_size" || cmd == "set_max_size") {
    // arg: "width\nheight" kv pairs via ParseKV-compatible "w=..\nh=.."
    KVList kv = ParseKV(arg.c_str());
    const char* prefix = cmd == "set_min_size" ? "min" : "max";
    SetWindowOpt(window_id, std::string(prefix) + "_width", KVGet(kv, "width", "0"));
    SetWindowOpt(window_id, std::string(prefix) + "_height", KVGet(kv, "height", "0"));
    if (window) window->Layout();
  }
}

void EvalJsOnUI(int32_t window_id, std::string code, int32_t eval_id) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry || !entry->browser) {
    if (eval_id > 0) {
      EmitEvent(JsonObj()
                    .AddString("type", "eval-result")
                    .AddInt("windowId", window_id)
                    .AddInt("evalId", eval_id)
                    .AddString("result", "\"window destroyed\"")
                    .AddBool("isError", true)
                    .Build());
    }
    return;
  }
  CefRefPtr<CefFrame> frame = entry->browser->GetMainFrame();
  if (eval_id > 0) {
    // Round-trip through the renderer's __be_eval so we can capture the
    // completion value (including promises).
    CefRefPtr<CefProcessMessage> msg = CefProcessMessage::Create("be-eval");
    CefRefPtr<CefListValue> args = msg->GetArgumentList();
    args->SetInt(0, eval_id);
    args->SetString(1, code);
    frame->SendProcessMessage(PID_RENDERER, msg);
  } else {
    frame->ExecuteJavaScript(code, frame->GetURL(), 0);
  }
}

void IpcSendOnUI(int32_t window_id, std::string channel, std::string args_json) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry || !entry->browser) return;
  CefRefPtr<CefProcessMessage> msg = CefProcessMessage::Create("be-ipc");
  CefRefPtr<CefListValue> args = msg->GetArgumentList();
  args->SetString(0, channel);
  args->SetString(1, args_json);
  entry->browser->GetMainFrame()->SendProcessMessage(PID_RENDERER, msg);
}

void IpcReplyOnUI(int32_t window_id,
                  int32_t invoke_id,
                  std::string result_json,
                  bool is_error) {
  CEF_REQUIRE_UI_THREAD();
  auto entry = FindWindow(window_id);
  if (!entry || !entry->browser) return;
  CefRefPtr<CefProcessMessage> msg = CefProcessMessage::Create("be-reply");
  CefRefPtr<CefListValue> args = msg->GetArgumentList();
  args->SetInt(0, invoke_id);
  args->SetString(1, result_json);
  args->SetBool(2, is_error);
  entry->browser->GetMainFrame()->SendProcessMessage(PID_RENDERER, msg);
}

void QuitOnUI() {
  CEF_REQUIRE_UI_THREAD();
  std::vector<std::shared_ptr<WindowEntry>> entries;
  {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    for (auto& [id, entry] : g_windows) entries.push_back(entry);
  }
  for (auto& entry : entries) {
    if (entry->browser) entry->browser->GetHost()->CloseBrowser(true);
    if (entry->window && !entry->window->IsClosed()) entry->window->Close();
  }
  EmitEvent(JsonObj().AddString("type", "quit").Build());
}

void PostToUI(base::OnceClosure task) {
  if (CefCurrentlyOn(TID_UI)) {
    std::move(task).Run();
  } else {
    CefPostTask(TID_UI, std::move(task));
  }
}

}  // namespace

// ---------------------------------------------------------------------------
// C ABI.
// ---------------------------------------------------------------------------

extern "C" {

BE_EXPORT int be_load_library(const char* framework_path) {
#if defined(__APPLE__)
  if (!framework_path) return 0;
  return cef_load_library(framework_path) ? 1 : 0;
#else
  (void)framework_path;
  return 1;
#endif
}

BE_EXPORT int be_init(const char* kv_str) {
  if (g_initialized.load()) return 0;
  KVList kv = ParseKV(kv_str);

#if defined(__APPLE__)
  be_mac_init_application();
#endif

#if !defined(_WIN32)
  if (pipe(g_event_pipe) == 0) {
    fcntl(g_event_pipe[0], F_SETFL, O_NONBLOCK);
  }
#endif

  for (auto& [k, v] : kv) {
    if (k == "switch") g_extra_switches.push_back(v);
    if (k == "custom_scheme") g_custom_schemes.push_back(v);
  }

  CefSettings settings;
  settings.no_sandbox = true;

  std::string subprocess = KVGet(kv, "subprocess_path");
  if (!subprocess.empty())
    CefString(&settings.browser_subprocess_path) = subprocess;

  std::string resources = KVGet(kv, "resources_dir");
  if (!resources.empty()) CefString(&settings.resources_dir_path) = resources;

  std::string locales = KVGet(kv, "locales_dir");
  if (!locales.empty()) CefString(&settings.locales_dir_path) = locales;

  std::string cache = KVGet(kv, "cache_dir");
  if (!cache.empty()) {
    CefString(&settings.root_cache_path) = cache;
    CefString(&settings.cache_path) = cache;
  }

  std::string log_file = KVGet(kv, "log_file");
  if (!log_file.empty()) CefString(&settings.log_file) = log_file;
  settings.log_severity =
      static_cast<cef_log_severity_t>(KVGetInt(kv, "log_severity", LOGSEVERITY_WARNING));

  int debug_port = KVGetInt(kv, "remote_debugging_port", 0);
  if (debug_port > 0) settings.remote_debugging_port = debug_port;

#if defined(__APPLE__)
  std::string framework_dir = KVGet(kv, "framework_dir");
  if (!framework_dir.empty())
    CefString(&settings.framework_dir_path) = framework_dir;
  std::string main_bundle = KVGet(kv, "main_bundle_path");
  if (!main_bundle.empty())
    CefString(&settings.main_bundle_path) = main_bundle;
  // macOS requires the UI loop on the process main thread; the JS side
  // drives it via be_do_message_loop_work().
  settings.external_message_pump = true;
  settings.multi_threaded_message_loop = false;
  g_external_pump = true;
#else
  bool external_pump = KVGetBool(kv, "external_pump", false);
  settings.external_message_pump = external_pump;
  settings.multi_threaded_message_loop = !external_pump;
  g_external_pump = external_pump;
#endif

  g_app = new App();

  static char arg0[] = "bun-electron";
  static char* argv[] = {arg0, nullptr};
#if defined(_WIN32)
  CefMainArgs main_args(::GetModuleHandle(nullptr));
#else
  CefMainArgs main_args(1, argv);
#endif

  if (!CefInitialize(main_args, settings, g_app, nullptr)) {
    return CefGetExitCode();
  }
  g_initialized = true;
  return 0;
}

BE_EXPORT int be_get_event_fd(void) {
#if !defined(_WIN32)
  return g_event_pipe[0];
#else
  return -1;
#endif
}

BE_EXPORT char* be_poll_events(void) {
  std::vector<std::string> events;
  {
    std::lock_guard<std::mutex> lock(g_events_mutex);
    events.swap(g_events);
  }
#if !defined(_WIN32)
  // Drain notification bytes.
  if (g_event_pipe[0] >= 0) {
    char buf[64];
    while (read(g_event_pipe[0], buf, sizeof(buf)) > 0) {
    }
  }
#endif
  if (events.empty()) return nullptr;
  std::string out = "[";
  for (size_t i = 0; i < events.size(); i++) {
    if (i) out += ',';
    out += events[i];
  }
  out += ']';
  char* result = static_cast<char*>(malloc(out.size() + 1));
  memcpy(result, out.c_str(), out.size() + 1);
  return result;
}

BE_EXPORT void be_free(char* p) {
  free(p);
}

BE_EXPORT int32_t be_window_create(const char* kv) {
  if (!g_initialized.load()) return -1;
  int32_t id = g_next_window_id.fetch_add(1);
  auto entry = std::make_shared<WindowEntry>();
  entry->id = id;
  entry->options = ParseKV(kv);
  entry->state.width = KVGetInt(entry->options, "width", 800);
  entry->state.height = KVGetInt(entry->options, "height", 600);
  entry->state.title = KVGet(entry->options, "title", "bun-electron");
  {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    g_windows[id] = entry;
  }
  PostToUI(base::BindOnce(&CreateWindowOnUI, id));
  return id;
}

BE_EXPORT void be_window_command(int32_t id, const char* cmd, const char* arg) {
  if (!cmd) return;
  PostToUI(base::BindOnce(&WindowCommandOnUI, id, std::string(cmd),
                          std::string(arg ? arg : "")));
}

BE_EXPORT char* be_window_get_state(int32_t id) {
  auto entry = FindWindow(id);
  if (!entry) return nullptr;
  WindowState st;
  {
    std::lock_guard<std::mutex> lock(g_windows_mutex);
    st = entry->state;
  }
  std::string out = JsonObj()
                        .AddInt("x", st.x)
                        .AddInt("y", st.y)
                        .AddInt("width", st.width)
                        .AddInt("height", st.height)
                        .AddBool("visible", st.visible)
                        .AddBool("focused", st.focused)
                        .AddBool("minimized", st.minimized)
                        .AddBool("maximized", st.maximized)
                        .AddBool("fullscreen", st.fullscreen)
                        .AddString("title", st.title)
                        .AddString("url", st.url)
                        .Build();
  char* result = static_cast<char*>(malloc(out.size() + 1));
  memcpy(result, out.c_str(), out.size() + 1);
  return result;
}

BE_EXPORT void be_window_eval_js(int32_t id, const char* code, int32_t eval_id) {
  if (!code) return;
  PostToUI(base::BindOnce(&EvalJsOnUI, id, std::string(code), eval_id));
}

BE_EXPORT void be_capture_page(int32_t id, int32_t capture_id) {
  PostToUI(base::BindOnce(&CapturePageOnUI, id, capture_id));
}

BE_EXPORT void be_devtools_method(int32_t id,
                                  int32_t call_id,
                                  const char* method,
                                  const char* params_json) {
  if (!method) return;
  PostToUI(base::BindOnce(&DevToolsMethodOnUI, id, call_id, std::string(method),
                          std::string(params_json ? params_json : "")));
}

// Trust an origin to read sendSync replies (called for each URL the app
// explicitly loads via loadURL).
BE_EXPORT void be_allow_ipc_origin(const char* origin) {
  if (!origin || !*origin) return;
  std::lock_guard<std::mutex> lock(g_ipc_origins_mutex);
  g_ipc_allowed_origins.insert(origin);
}

// Enable/disable webRequest interception (set when JS registers/clears an
// onBeforeRequest listener).
BE_EXPORT void be_web_request_set_active(int32_t active) {
  g_web_request_active.store(active != 0);
}

// Resolve a pending onBeforeRequest: cancel != 0 blocks the load.
BE_EXPORT void be_web_request_continue(int32_t request_id, int32_t cancel) {
  CefRefPtr<CefCallback> callback;
  {
    std::lock_guard<std::mutex> lock(g_web_request_mutex);
    auto it = g_web_request_callbacks.find(request_id);
    if (it == g_web_request_callbacks.end()) return;
    callback = it->second;
    g_web_request_callbacks.erase(it);
  }
  if (cancel) callback->Cancel();
  else callback->Continue();
}

BE_EXPORT void be_ipc_send(int32_t id, const char* channel, const char* args_json) {
  if (!channel) return;
  PostToUI(base::BindOnce(&IpcSendOnUI, id, std::string(channel),
                          std::string(args_json ? args_json : "[]")));
}

BE_EXPORT void be_ipc_reply(int32_t id,
                            int32_t invoke_id,
                            const char* result_json,
                            int32_t is_error) {
  PostToUI(base::BindOnce(&IpcReplyOnUI, id, invoke_id,
                          std::string(result_json ? result_json : "null"),
                          is_error != 0));
}

BE_EXPORT void be_do_message_loop_work(void) {
  if (g_initialized.load()) CefDoMessageLoopWork();
}

BE_EXPORT void be_quit(void) {
  if (!g_initialized.load()) return;
  PostToUI(base::BindOnce(&QuitOnUI));
}

BE_EXPORT void be_shutdown(void) {
  if (!g_initialized.load()) return;
  g_initialized = false;
  CefShutdown();
}

BE_EXPORT void be_resource_reply(int32_t resource_id,
                                 int32_t status,
                                 const char* mime,
                                 const char* body_base64) {
  CefRefPtr<PendingResourceHandler> handler;
  {
    std::lock_guard<std::mutex> lock(g_resources_mutex);
    auto it = g_pending_resources.find(resource_id);
    if (it == g_pending_resources.end()) return;
    handler = it->second;
    g_pending_resources.erase(it);
  }
  std::string body;
  if (body_base64 && *body_base64) {
    CefRefPtr<CefBinaryValue> bin = CefBase64Decode(body_base64);
    if (bin) {
      body.resize(bin->GetSize());
      bin->GetData(body.data(), body.size(), 0);
    }
  }
  handler->Resolve(status, mime ? mime : "", std::move(body));
}

BE_EXPORT void be_run_file_dialog(int32_t window_id, int32_t dialog_id, const char* kv) {
  PostToUI(base::BindOnce(&RunFileDialogOnUI, window_id, dialog_id,
                          std::string(kv ? kv : "")));
}

BE_EXPORT void be_cookies_op(int32_t op_id, const char* op, const char* kv) {
  if (!op) return;
  PostToUI(base::BindOnce(&CookiesOpOnUI, op_id, std::string(op),
                          std::string(kv ? kv : "")));
}

BE_EXPORT char* be_screen_info(void) {
  if (!g_initialized.load()) return nullptr;
  std::string json;
  if (CefCurrentlyOn(TID_UI)) {
    json = ScreenInfoJson();
  } else {
    // Block briefly on the UI thread; safe because the JS thread is never
    // the UI thread when the multi-threaded message loop is in use.
    std::mutex m;
    std::condition_variable cv;
    bool done = false;
    CefPostTask(TID_UI, base::BindOnce(
                            [](std::string* out, std::mutex* mu,
                               std::condition_variable* cond, bool* flag) {
                              *out = ScreenInfoJson();
                              std::lock_guard<std::mutex> lock(*mu);
                              *flag = true;
                              cond->notify_one();
                            },
                            &json, &m, &cv, &done));
    std::unique_lock<std::mutex> lock(m);
    if (!cv.wait_for(lock, std::chrono::seconds(5), [&] { return done; })) {
      return nullptr;
    }
  }
  char* result = static_cast<char*>(malloc(json.size() + 1));
  memcpy(result, json.c_str(), json.size() + 1);
  return result;
}

BE_EXPORT char* be_version(void) {
  std::string v = std::string("bun-electron-shim 0.1.0 cef ") +
                  CEF_VERSION;
  char* result = static_cast<char*>(malloc(v.size() + 1));
  memcpy(result, v.c_str(), v.size() + 1);
  return result;
}

}  // extern "C"
