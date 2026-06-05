// bun-electron native shim — browser-process side.
// See shim.h for the C ABI contract and threading model.

#include "shim.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_command_line.h"
#include "include/cef_devtools_message_observer.h"
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
  WindowState state;
  bool destroyed = false;
};

std::mutex g_windows_mutex;
std::map<int32_t, std::shared_ptr<WindowEntry>> g_windows;
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
               public CefDisplayHandler {
 public:
  explicit Client(int32_t window_id) : window_id_(window_id) {}

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }

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
                     WindowOpenDisposition target_disposition,
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

// window.open() popups: allocate the window entry and give the popup its own
// Client so events are attributed correctly from the first callback.
bool Client::OnBeforePopup(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           int popup_id,
                           const CefString& target_url,
                           const CefString& target_frame_name,
                           WindowOpenDisposition target_disposition,
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
    int32_t capture_id;
    {
      std::lock_guard<std::mutex> lock(g_windows_mutex);
      auto it = entry->pending_captures.find(message_id);
      if (it == entry->pending_captures.end()) return;
      capture_id = it->second;
      entry->pending_captures.erase(it);
    }
    std::string json(static_cast<const char*>(result), result_size);
    EmitEvent(JsonObj()
                  .AddString("type", "capture-result")
                  .AddInt("windowId", window_id_)
                  .AddInt("captureId", capture_id)
                  .AddBool("success", success)
                  .AddRaw("result", json.empty() ? "null" : json)
                  .Build());
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

// ---------------------------------------------------------------------------
// App: browser-process CefApp.
// ---------------------------------------------------------------------------

std::vector<std::string> g_extra_switches;

class App : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
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
  if (!preload.empty()) {
    extra_info = CefDictionaryValue::Create();
    extra_info->SetString("preload", preload);
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
  } else if (cmd == "set_resizable" || cmd == "set_minimizable" ||
             cmd == "set_maximizable") {
    SetWindowOpt(window_id, cmd.substr(4), arg == "1" ? "1" : "0");
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

BE_EXPORT char* be_version(void) {
  std::string v = std::string("bun-electron-shim 0.1.0 cef ") +
                  CEF_VERSION;
  char* result = static_cast<char*>(malloc(v.size() + 1));
  memcpy(result, v.c_str(), v.size() + 1);
  return result;
}

}  // extern "C"
