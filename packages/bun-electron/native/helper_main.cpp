// bun-electron helper — the CEF subprocess executable (renderer, GPU,
// utility, ...). The browser process is Bun itself (via the shim dylib), so
// every CEF subprocess runs this binary instead, configured through
// CefSettings.browser_subprocess_path.
//
// In renderer processes this installs the V8 bindings that back the
// `ipcRenderer` API (see renderer_bootstrap.h).

#include <map>
#include <string>

#include "include/cef_app.h"
#include "include/cef_command_line.h"
#include "include/cef_scheme.h"
#include "include/cef_render_process_handler.h"
#include "include/cef_v8.h"
#include "include/wrapper/cef_helpers.h"

#include "renderer_bootstrap.h"

#if defined(__APPLE__)
#include "include/wrapper/cef_library_loader.h"
#endif

#if defined(_WIN32)
#include <windows.h>
#endif

namespace {

class IpcV8Handler : public CefV8Handler {
 public:
  bool Execute(const CefString& name,
               CefRefPtr<CefV8Value> object,
               const CefV8ValueList& arguments,
               CefRefPtr<CefV8Value>& retval,
               CefString& exception) override {
    CefRefPtr<CefV8Context> context = CefV8Context::GetCurrentContext();
    CefRefPtr<CefFrame> frame = context ? context->GetFrame() : nullptr;
    if (!frame) return false;

    if (name == "__be_send" && arguments.size() == 2) {
      CefRefPtr<CefProcessMessage> msg = CefProcessMessage::Create("be-ipc");
      CefRefPtr<CefListValue> args = msg->GetArgumentList();
      args->SetString(0, arguments[0]->GetStringValue());
      args->SetString(1, arguments[1]->GetStringValue());
      frame->SendProcessMessage(PID_BROWSER, msg);
      return true;
    }
    if (name == "__be_invoke" && arguments.size() == 3) {
      CefRefPtr<CefProcessMessage> msg = CefProcessMessage::Create("be-invoke");
      CefRefPtr<CefListValue> args = msg->GetArgumentList();
      args->SetInt(0, arguments[0]->GetIntValue());
      args->SetString(1, arguments[1]->GetStringValue());
      args->SetString(2, arguments[2]->GetStringValue());
      frame->SendProcessMessage(PID_BROWSER, msg);
      return true;
    }
    if (name == "__be_eval_done" && arguments.size() == 3) {
      CefRefPtr<CefProcessMessage> msg =
          CefProcessMessage::Create("be-eval-result");
      CefRefPtr<CefListValue> args = msg->GetArgumentList();
      args->SetInt(0, arguments[0]->GetIntValue());
      args->SetString(1, arguments[1]->GetStringValue());
      args->SetBool(2, arguments[2]->GetBoolValue());
      frame->SendProcessMessage(PID_BROWSER, msg);
      return true;
    }
    return false;
  }

  IMPLEMENT_REFCOUNTING(IpcV8Handler);
};

class HelperApp : public CefApp, public CefRenderProcessHandler {
 public:
  CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override {
    return this;
  }

  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) override {
    // Mirror the browser process's scheme registration; the list arrives on
    // the command line (see App::OnBeforeChildProcessLaunch in shim.cpp).
    CefRefPtr<CefCommandLine> cl = CefCommandLine::GetGlobalCommandLine();
    std::string schemes = cl ? cl->GetSwitchValue("be-custom-schemes").ToString() : "";
    if (schemes.empty()) schemes = "beipc";
    const int options = CEF_SCHEME_OPTION_STANDARD | CEF_SCHEME_OPTION_SECURE |
                        CEF_SCHEME_OPTION_CORS_ENABLED |
                        CEF_SCHEME_OPTION_FETCH_ENABLED;
    size_t start = 0;
    while (start <= schemes.size()) {
      size_t comma = schemes.find(',', start);
      std::string scheme = schemes.substr(
          start, comma == std::string::npos ? std::string::npos : comma - start);
      if (!scheme.empty()) registrar->AddCustomScheme(scheme, options);
      if (comma == std::string::npos) break;
      start = comma + 1;
    }
  }

  void OnBrowserCreated(CefRefPtr<CefBrowser> browser,
                        CefRefPtr<CefDictionaryValue> extra_info) override {
    if (extra_info && extra_info->HasKey("preload")) {
      preload_by_browser_[browser->GetIdentifier()] =
          extra_info->GetString("preload").ToString();
    }
  }

  void OnBrowserDestroyed(CefRefPtr<CefBrowser> browser) override {
    preload_by_browser_.erase(browser->GetIdentifier());
  }

  void OnContextCreated(CefRefPtr<CefBrowser> browser,
                        CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefV8Context> context) override {
    if (!frame->IsMain()) return;

    CefRefPtr<CefV8Value> global = context->GetGlobal();
    CefRefPtr<CefV8Handler> handler = new IpcV8Handler();
    static const char* kFns[] = {"__be_send", "__be_invoke", "__be_eval_done"};
    for (const char* fn : kFns) {
      global->SetValue(fn, CefV8Value::CreateFunction(fn, handler),
                       V8_PROPERTY_ATTRIBUTE_READONLY);
    }

    CefRefPtr<CefV8Value> retval;
    CefRefPtr<CefV8Exception> exc;
    context->Eval(kRendererBootstrapJs, frame->GetURL(), 0, retval, exc);

    // Preload runs after the bootstrap (so ipcRenderer/contextBridge exist)
    // and before any page script, matching Electron's ordering.
    auto it = preload_by_browser_.find(browser->GetIdentifier());
    if (it != preload_by_browser_.end() && !it->second.empty()) {
      CefRefPtr<CefV8Value> preload_ret;
      CefRefPtr<CefV8Exception> preload_exc;
      if (!context->Eval(it->second, "bun-electron://preload", 0, preload_ret,
                         preload_exc) &&
          preload_exc) {
        // Surface the failure as a console message (reaches the browser
        // process via OnConsoleMessage). Call console.error through the V8
        // API — never by concatenating the message into JS source.
        CefRefPtr<CefV8Value> console = global->GetValue("console");
        CefRefPtr<CefV8Value> error_fn =
            console && console->IsObject() ? console->GetValue("error") : nullptr;
        if (error_fn && error_fn->IsFunction()) {
          CefV8ValueList args;
          args.push_back(CefV8Value::CreateString(
              "preload error: " + preload_exc->GetMessage().ToString()));
          error_fn->ExecuteFunctionWithContext(context, console, args);
        }
      }
    }
  }

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override {
    const std::string name = message->GetName().ToString();
    const char* fn_name = nullptr;
    if (name == "be-ipc") {
      fn_name = "__be_dispatch";
    } else if (name == "be-reply") {
      fn_name = "__be_reply";
    } else if (name == "be-eval") {
      fn_name = "__be_eval";
    } else {
      return false;
    }

    CefRefPtr<CefListValue> margs = message->GetArgumentList();
    CefRefPtr<CefV8Context> context = frame->GetV8Context();
    if (!context || !context->Enter()) return true;

    CefV8ValueList args;
    for (size_t i = 0; i < margs->GetSize(); i++) {
      switch (margs->GetType(i)) {
        case VTYPE_INT:
          args.push_back(CefV8Value::CreateInt(margs->GetInt(i)));
          break;
        case VTYPE_BOOL:
          args.push_back(CefV8Value::CreateBool(margs->GetBool(i)));
          break;
        default:
          args.push_back(CefV8Value::CreateString(margs->GetString(i)));
      }
    }

    CefRefPtr<CefV8Value> global = context->GetGlobal();
    CefRefPtr<CefV8Value> fn = global->GetValue(fn_name);
    if (fn && fn->IsFunction()) {
      fn->ExecuteFunction(global, args);
    }
    context->Exit();
    return true;
  }

 private:
  // browser id -> preload source (from CreateBrowserView extra_info).
  std::map<int, std::string> preload_by_browser_;

  IMPLEMENT_REFCOUNTING(HelperApp);
};

}  // namespace

#if defined(_WIN32)

int APIENTRY wWinMain(HINSTANCE hInstance,
                      HINSTANCE hPrevInstance,
                      LPWSTR lpCmdLine,
                      int nCmdShow) {
  CefMainArgs main_args(hInstance);
  CefRefPtr<HelperApp> app = new HelperApp();
  return CefExecuteProcess(main_args, app, nullptr);
}

#else

int main(int argc, char* argv[]) {
#if defined(__APPLE__)
  // Load the CEF framework in the helper using the path passed on the
  // command line by the browser process.
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInHelper()) {
    return 1;
  }
#endif
  CefMainArgs main_args(argc, argv);
  CefRefPtr<HelperApp> app = new HelperApp();
  return CefExecuteProcess(main_args, app, nullptr);
}

#endif
