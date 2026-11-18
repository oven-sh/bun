#include "root.h"

#if OS(LINUX)

#include <dlfcn.h>
#include <stdint.h>
#include <string>
#include <unordered_map>
#include <mutex>

namespace Zig {
class GlobalObject;
}

extern "C" {
void Bun__Desktop__onNavDone(Zig::GlobalObject* g, uint32_t windowId, bool ok, const uint8_t* errPtr, uint32_t errLen);
void Bun__Desktop__onIpcMessage(Zig::GlobalObject* g, uint32_t windowId, uint32_t reqId, bool isInvoke, const uint8_t* chPtr, uint32_t chLen, const uint8_t* argsPtr, uint32_t argsLen);
void Bun__Desktop__onWindowClosed(Zig::GlobalObject* g, uint32_t windowId);
void Bun__Desktop__onSchemeRequest(Zig::GlobalObject* g, uint32_t windowId, uint32_t taskId, const uint8_t* urlPtr, uint32_t urlLen, const uint8_t* methodPtr, uint32_t methodLen, const uint8_t* rangePtr, uint32_t rangeLen, const uint8_t* headersPtr, uint32_t headersLen, const uint8_t* bodyPtr, uint32_t bodyLen);
}

namespace Bun {
namespace DesktopLinux {

struct GtkApi {
    bool loaded = false;
    void* libgtk = nullptr;
    void* libwebkit = nullptr;
    int (*gtk_init_check)(int*, char***) = nullptr;
    void* (*gtk_window_new)(int) = nullptr;
    void (*gtk_window_set_title)(void*, const char*) = nullptr;
    void (*gtk_window_set_default_size)(void*, int, int) = nullptr;
    void (*gtk_window_resize)(void*, int, int) = nullptr;
    void (*gtk_window_set_resizable)(void*, int) = nullptr;
    void (*gtk_window_set_decorated)(void*, int) = nullptr;
    void (*gtk_widget_show_all)(void*) = nullptr;
    void (*gtk_widget_hide)(void*) = nullptr;
    void (*gtk_widget_destroy)(void*) = nullptr;
    void (*gtk_container_add)(void*, void*) = nullptr;
    void* (*webkit_web_view_new)() = nullptr;
    void (*webkit_web_view_load_uri)(void*, const char*) = nullptr;
};

static GtkApi s_api;
static std::mutex s_mu;
static uint32_t s_nextId = 1;

struct WinEntry {
    uint32_t id = 0;
    void* gtkWindow = nullptr;
    void* webview = nullptr;
    Zig::GlobalObject* global = nullptr;
    bool closed = false;
};

static std::unordered_map<uint32_t, WinEntry*> s_windows;

static bool ensureLoaded()
{
    if (s_api.loaded) return s_api.libgtk != nullptr;
    s_api.loaded = true;
    s_api.libgtk = dlopen("libgtk-3.so.0", RTLD_LAZY | RTLD_LOCAL);
    s_api.libwebkit = dlopen("libwebkit2gtk-4.1.so.0", RTLD_LAZY | RTLD_LOCAL);
    if (!s_api.libwebkit) {
        s_api.libwebkit = dlopen("libwebkit2gtk-4.0.so.37", RTLD_LAZY | RTLD_LOCAL);
    }
    if (!s_api.libgtk) return false;

    s_api.gtk_init_check = reinterpret_cast<decltype(s_api.gtk_init_check)>(dlsym(s_api.libgtk, "gtk_init_check"));
    s_api.gtk_window_new = reinterpret_cast<decltype(s_api.gtk_window_new)>(dlsym(s_api.libgtk, "gtk_window_new"));
    s_api.gtk_window_set_title = reinterpret_cast<decltype(s_api.gtk_window_set_title)>(dlsym(s_api.libgtk, "gtk_window_set_title"));
    s_api.gtk_window_set_default_size = reinterpret_cast<decltype(s_api.gtk_window_set_default_size)>(dlsym(s_api.libgtk, "gtk_window_set_default_size"));
    s_api.gtk_window_resize = reinterpret_cast<decltype(s_api.gtk_window_resize)>(dlsym(s_api.libgtk, "gtk_window_resize"));
    s_api.gtk_window_set_resizable = reinterpret_cast<decltype(s_api.gtk_window_set_resizable)>(dlsym(s_api.libgtk, "gtk_window_set_resizable"));
    s_api.gtk_window_set_decorated = reinterpret_cast<decltype(s_api.gtk_window_set_decorated)>(dlsym(s_api.libgtk, "gtk_window_set_decorated"));
    s_api.gtk_widget_show_all = reinterpret_cast<decltype(s_api.gtk_widget_show_all)>(dlsym(s_api.libgtk, "gtk_widget_show_all"));
    s_api.gtk_widget_hide = reinterpret_cast<decltype(s_api.gtk_widget_hide)>(dlsym(s_api.libgtk, "gtk_widget_hide"));
    s_api.gtk_widget_destroy = reinterpret_cast<decltype(s_api.gtk_widget_destroy)>(dlsym(s_api.libgtk, "gtk_widget_destroy"));
    s_api.gtk_container_add = reinterpret_cast<decltype(s_api.gtk_container_add)>(dlsym(s_api.libgtk, "gtk_container_add"));

    if (s_api.libwebkit) {
        s_api.webkit_web_view_new = reinterpret_cast<decltype(s_api.webkit_web_view_new)>(dlsym(s_api.libwebkit, "webkit_web_view_new"));
        s_api.webkit_web_view_load_uri = reinterpret_cast<decltype(s_api.webkit_web_view_load_uri)>(dlsym(s_api.libwebkit, "webkit_web_view_load_uri"));
    }

    if (s_api.gtk_init_check) {
        s_api.gtk_init_check(nullptr, nullptr);
    }
    return true;
}

} // namespace DesktopLinux
} // namespace Bun

extern "C" uint32_t Bun__Desktop__createWindow(
    Zig::GlobalObject* g,
    int32_t width,
    int32_t height,
    int32_t /*x*/,
    int32_t /*y*/,
    uint8_t flags,
    const char* titlePtr,
    uint32_t titleLen,
    const char* /*preloadPtr*/,
    uint32_t /*preloadLen*/)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopLinux::s_mu);
    uint32_t id = Bun::DesktopLinux::s_nextId++;
    auto* entry = new Bun::DesktopLinux::WinEntry();
    entry->id = id;
    entry->global = g;

    if (Bun::DesktopLinux::ensureLoaded() && Bun::DesktopLinux::s_api.gtk_window_new) {
        auto& api = Bun::DesktopLinux::s_api;
        entry->gtkWindow = api.gtk_window_new(0 /* GTK_WINDOW_TOPLEVEL */);
        if (entry->gtkWindow) {
            std::string title(titlePtr ? titlePtr : "", titleLen);
            if (api.gtk_window_set_title) api.gtk_window_set_title(entry->gtkWindow, title.c_str());
            if (api.gtk_window_set_default_size) api.gtk_window_set_default_size(entry->gtkWindow, width > 0 ? width : 800, height > 0 ? height : 600);
            if (api.gtk_window_set_resizable) api.gtk_window_set_resizable(entry->gtkWindow, (flags & 2) != 0 ? 1 : 0);
            if (api.gtk_window_set_decorated) api.gtk_window_set_decorated(entry->gtkWindow, (flags & 4) != 0 ? 1 : 0);
            if (api.webkit_web_view_new && api.gtk_container_add) {
                entry->webview = api.webkit_web_view_new();
                if (entry->webview) api.gtk_container_add(entry->gtkWindow, entry->webview);
            }
            if ((flags & 1) != 0 && api.gtk_widget_show_all) {
                api.gtk_widget_show_all(entry->gtkWindow);
            }
        }
    }

    Bun::DesktopLinux::s_windows.emplace(id, entry);
    return id;
}

extern "C" void Bun__Desktop__navigate(uint32_t id, const char* urlPtr, uint32_t urlLen)
{
    Zig::GlobalObject* g = nullptr;
    void* wv = nullptr;
    {
        std::lock_guard<std::mutex> lock(Bun::DesktopLinux::s_mu);
        auto it = Bun::DesktopLinux::s_windows.find(id);
        if (it == Bun::DesktopLinux::s_windows.end()) return;
        g = it->second->global;
        wv = it->second->webview;
    }
    if (wv && Bun::DesktopLinux::s_api.webkit_web_view_load_uri) {
        std::string url(urlPtr ? urlPtr : "", urlLen);
        Bun::DesktopLinux::s_api.webkit_web_view_load_uri(wv, url.c_str());
    }
    Bun__Desktop__onNavDone(g, id, true, nullptr, 0);
}

extern "C" void Bun__Desktop__close(uint32_t id)
{
    void* win = nullptr;
    Zig::GlobalObject* g = nullptr;
    {
        std::lock_guard<std::mutex> lock(Bun::DesktopLinux::s_mu);
        auto it = Bun::DesktopLinux::s_windows.find(id);
        if (it == Bun::DesktopLinux::s_windows.end()) return;
        win = it->second->gtkWindow;
        g = it->second->global;
        delete it->second;
        Bun::DesktopLinux::s_windows.erase(it);
    }
    if (win && Bun::DesktopLinux::s_api.gtk_widget_destroy) {
        Bun::DesktopLinux::s_api.gtk_widget_destroy(win);
    }
    Bun__Desktop__onWindowClosed(g, id);
}

extern "C" void Bun__Desktop__setTitle(uint32_t id, const char* titlePtr, uint32_t titleLen)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopLinux::s_mu);
    auto it = Bun::DesktopLinux::s_windows.find(id);
    if (it == Bun::DesktopLinux::s_windows.end() || !it->second->gtkWindow) return;
    if (Bun::DesktopLinux::s_api.gtk_window_set_title) {
        std::string title(titlePtr ? titlePtr : "", titleLen);
        Bun::DesktopLinux::s_api.gtk_window_set_title(it->second->gtkWindow, title.c_str());
    }
}

extern "C" void Bun__Desktop__showWindow(uint32_t id, bool visible)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopLinux::s_mu);
    auto it = Bun::DesktopLinux::s_windows.find(id);
    if (it == Bun::DesktopLinux::s_windows.end() || !it->second->gtkWindow) return;
    if (visible && Bun::DesktopLinux::s_api.gtk_widget_show_all) {
        Bun::DesktopLinux::s_api.gtk_widget_show_all(it->second->gtkWindow);
    } else if (!visible && Bun::DesktopLinux::s_api.gtk_widget_hide) {
        Bun::DesktopLinux::s_api.gtk_widget_hide(it->second->gtkWindow);
    }
}

extern "C" void Bun__Desktop__setSize(uint32_t id, uint32_t width, uint32_t height)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopLinux::s_mu);
    auto it = Bun::DesktopLinux::s_windows.find(id);
    if (it == Bun::DesktopLinux::s_windows.end() || !it->second->gtkWindow) return;
    if (Bun::DesktopLinux::s_api.gtk_window_resize) {
        Bun::DesktopLinux::s_api.gtk_window_resize(it->second->gtkWindow, static_cast<int>(width), static_cast<int>(height));
    }
}

extern "C" void Bun__Desktop__sendIpcReply(uint32_t, uint32_t, bool, const char*, uint32_t) {}
extern "C" void Bun__Desktop__sendIpcBinaryReply(uint32_t, uint32_t, uint16_t, const uint8_t*, uint32_t) {}
extern "C" void Bun__Desktop__dispatchToRenderer(uint32_t, const char*, uint32_t, const char*, uint32_t) {}
extern "C" void Bun__Desktop__sendSchemeResponseBytes(uint32_t, uint32_t, uint16_t, const char*, uint32_t, const uint8_t*, uint32_t) {}
extern "C" void Bun__Desktop__sendSchemeResponseFile(uint32_t, uint32_t, uint16_t, const char*, uint32_t, const char*, uint32_t, uint64_t, uint64_t) {}
extern "C" void Bun__Desktop__sendSchemeResponseError(uint32_t, uint32_t, uint16_t) {}
extern "C" void Bun__Desktop__windowAction(uint32_t, uint8_t) {}
extern "C" bool Bun__Desktop__clipboardWriteText(const char*, uint32_t) { return false; }
extern "C" uint32_t Bun__Desktop__clipboardReadText(char*, uint32_t) { return 0; }
extern "C" bool Bun__Desktop__isDarkMode() { return false; }
extern "C" bool Bun__Desktop__getPrimaryDisplay(double*) { return false; }
extern "C" void Bun__Desktop__setWindowProgress(uint32_t, double) {}
extern "C" void Bun__Desktop__setMenu(const char*, uint32_t) {}
extern "C" void Bun__Desktop__showDialog(Zig::GlobalObject*, uint32_t, uint32_t, uint8_t, const char*, uint32_t) {}
extern "C" uint32_t Bun__Desktop__powerSaveStart(uint8_t) { return 0; }
extern "C" bool Bun__Desktop__powerSaveStop(uint32_t) { return false; }
extern "C" bool Bun__Desktop__powerSaveIsStarted(uint32_t) { return false; }
extern "C" bool Bun__Desktop__imageSizeFromPath(const char*, uint32_t, double*) { return false; }
extern "C" bool Bun__Desktop__openExternal(const char*, uint32_t) { return false; }
extern "C" bool Bun__Desktop__showItemInFolder(const char*, uint32_t) { return false; }
extern "C" bool Bun__Desktop__trashItem(const char*, uint32_t) { return false; }
extern "C" bool Bun__Desktop__showNotification(const char*, uint32_t, const char*, uint32_t) { return false; }
extern "C" void Bun__Desktop__warm(Zig::GlobalObject*) {}
extern "C" void Bun__Desktop__registerScheme(const char*, uint32_t) {}
extern "C" void Bun__Desktop__evaluateJS(uint32_t, uint32_t, const char*, uint32_t) {}

#endif // OS(LINUX)
