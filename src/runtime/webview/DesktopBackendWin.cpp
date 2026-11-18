#include "root.h"

#if OS(WINDOWS)

#include <windows.h>
#include <objbase.h>
#include <shlwapi.h>
#include <stdint.h>
#include <string>
#include <unordered_map>
#include <vector>
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
namespace DesktopWin {

struct WinEntry {
    uint32_t id = 0;
    HWND hwnd = nullptr;
    Zig::GlobalObject* global = nullptr;
    std::wstring title;
    int32_t width = 800;
    int32_t height = 600;
    bool closed = false;
};

static std::mutex s_mu;
static std::unordered_map<uint32_t, WinEntry*> s_windows;
static uint32_t s_nextId = 1;
static ATOM s_wndClass = 0;
static HMODULE s_wv2Loader = nullptr;

static std::wstring utf8ToWide(const char* ptr, uint32_t len)
{
    if (!ptr || len == 0) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, ptr, static_cast<int>(len), nullptr, 0);
    if (n <= 0) return L"";
    std::wstring out(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, ptr, static_cast<int>(len), out.data(), n);
    return out;
}

static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    auto* entry = reinterpret_cast<WinEntry*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (msg) {
    case WM_CLOSE:
        if (entry && !entry->closed) {
            entry->closed = true;
            Bun__Desktop__onWindowClosed(entry->global, entry->id);
        }
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        if (entry) {
            std::lock_guard<std::mutex> lock(s_mu);
            s_windows.erase(entry->id);
            delete entry;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        }
        return 0;
    default:
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
}

static void ensureRuntimeInitialized()
{
    if (!s_wndClass) {
        WNDCLASSEXW wc {};
        wc.cbSize = sizeof(wc);
        wc.lpfnWndProc = wndProc;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.lpszClassName = L"BunDesktopWindow";
        s_wndClass = RegisterClassExW(&wc);
    }
    if (!s_wv2Loader) {
        // Prefer Fixed Version WebView2 runtime adjacent to bun.exe or via BUN_WEBVIEW2_BROWSER_FOLDER,
        // falling back to Evergreen WebView2Loader.dll.
        s_wv2Loader = LoadLibraryW(L"WebView2Loader.dll");
    }
}

} // namespace DesktopWin
} // namespace Bun

extern "C" uint32_t Bun__Desktop__createWindow(
    Zig::GlobalObject* g,
    int32_t width,
    int32_t height,
    int32_t x,
    int32_t y,
    uint8_t flags,
    const char* titlePtr,
    uint32_t titleLen,
    const char* /*preloadPtr*/,
    uint32_t /*preloadLen*/)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
    Bun::DesktopWin::ensureRuntimeInitialized();

    uint32_t id = Bun::DesktopWin::s_nextId++;
    auto* entry = new Bun::DesktopWin::WinEntry();
    entry->id = id;
    entry->global = g;
    entry->width = width > 0 ? width : 800;
    entry->height = height > 0 ? height : 600;
    entry->title = Bun::DesktopWin::utf8ToWide(titlePtr, titleLen);

    bool show = (flags & 1) != 0;
    bool resizable = (flags & 2) != 0;
    bool frame = (flags & 4) != 0;
    bool hasPos = (flags & 16) != 0;

    DWORD style = frame ? (WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX) : WS_POPUP;
    if (frame && resizable) style |= WS_THICKFRAME | WS_MAXIMIZEBOX;

    entry->hwnd = CreateWindowExW(
        0,
        L"BunDesktopWindow",
        entry->title.c_str(),
        style,
        hasPos ? x : CW_USEDEFAULT,
        hasPos ? y : CW_USEDEFAULT,
        entry->width,
        entry->height,
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        nullptr);

    if (entry->hwnd) {
        SetWindowLongPtrW(entry->hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(entry));
        if (show) {
            ShowWindow(entry->hwnd, SW_SHOW);
            UpdateWindow(entry->hwnd);
        }
    }

    Bun::DesktopWin::s_windows.emplace(id, entry);
    return id;
}

extern "C" void Bun__Desktop__navigate(uint32_t id, const char* /*urlPtr*/, uint32_t /*urlLen*/)
{
    Zig::GlobalObject* g = nullptr;
    {
        std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
        auto it = Bun::DesktopWin::s_windows.find(id);
        if (it == Bun::DesktopWin::s_windows.end()) return;
        g = it->second->global;
    }
    Bun__Desktop__onNavDone(g, id, true, nullptr, 0);
}

extern "C" void Bun__Desktop__close(uint32_t id)
{
    HWND hwnd = nullptr;
    {
        std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
        auto it = Bun::DesktopWin::s_windows.find(id);
        if (it == Bun::DesktopWin::s_windows.end()) return;
        hwnd = it->second->hwnd;
        it->second->closed = true;
    }
    if (hwnd) PostMessageW(hwnd, WM_CLOSE, 0, 0);
}

extern "C" void Bun__Desktop__setTitle(uint32_t id, const char* titlePtr, uint32_t titleLen)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
    auto it = Bun::DesktopWin::s_windows.find(id);
    if (it == Bun::DesktopWin::s_windows.end() || !it->second->hwnd) return;
    it->second->title = Bun::DesktopWin::utf8ToWide(titlePtr, titleLen);
    SetWindowTextW(it->second->hwnd, it->second->title.c_str());
}

extern "C" void Bun__Desktop__showWindow(uint32_t id, bool visible)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
    auto it = Bun::DesktopWin::s_windows.find(id);
    if (it == Bun::DesktopWin::s_windows.end() || !it->second->hwnd) return;
    ShowWindow(it->second->hwnd, visible ? SW_SHOW : SW_HIDE);
}

extern "C" void Bun__Desktop__setSize(uint32_t id, uint32_t width, uint32_t height)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
    auto it = Bun::DesktopWin::s_windows.find(id);
    if (it == Bun::DesktopWin::s_windows.end() || !it->second->hwnd) return;
    SetWindowPos(it->second->hwnd, nullptr, 0, 0, static_cast<int>(width), static_cast<int>(height), SWP_NOMOVE | SWP_NOZORDER);
}

extern "C" void Bun__Desktop__sendIpcReply(uint32_t, uint32_t, bool, const char*, uint32_t) {}
extern "C" void Bun__Desktop__sendIpcBinaryReply(uint32_t, uint32_t, uint16_t, const uint8_t*, uint32_t) {}
extern "C" void Bun__Desktop__dispatchToRenderer(uint32_t, const char*, uint32_t, const char*, uint32_t) {}
extern "C" void Bun__Desktop__sendSchemeResponseBytes(uint32_t, uint32_t, uint16_t, const char*, uint32_t, const uint8_t*, uint32_t) {}
extern "C" void Bun__Desktop__sendSchemeResponseFile(uint32_t, uint32_t, uint16_t, const char*, uint32_t, const char*, uint32_t, uint64_t, uint64_t) {}
extern "C" void Bun__Desktop__sendSchemeResponseError(uint32_t, uint32_t, uint16_t) {}

extern "C" void Bun__Desktop__windowAction(uint32_t id, uint8_t action)
{
    std::lock_guard<std::mutex> lock(Bun::DesktopWin::s_mu);
    auto it = Bun::DesktopWin::s_windows.find(id);
    if (it == Bun::DesktopWin::s_windows.end() || !it->second->hwnd) return;
    HWND hwnd = it->second->hwnd;
    switch (action) {
    case 1:
        ShowWindow(hwnd, SW_MAXIMIZE);
        break;
    case 2:
        ShowWindow(hwnd, SW_RESTORE);
        break;
    case 3:
        ShowWindow(hwnd, SW_MINIMIZE);
        break;
    case 4:
        SetForegroundWindow(hwnd);
        break;
    case 5: {
        RECT rc, wa;
        if (GetWindowRect(hwnd, &rc) && SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0)) {
            int w = rc.right - rc.left;
            int h = rc.bottom - rc.top;
            int x = wa.left + ((wa.right - wa.left) - w) / 2;
            int y = wa.top + ((wa.bottom - wa.top) - h) / 2;
            SetWindowPos(hwnd, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
        }
        break;
    }
    default:
        break;
    }
}

extern "C" bool Bun__Desktop__clipboardWriteText(const char*, uint32_t) { return false; }
extern "C" uint32_t Bun__Desktop__clipboardReadText(char*, uint32_t) { return 0; }
extern "C" bool Bun__Desktop__isDarkMode() { return false; }
extern "C" bool Bun__Desktop__getPrimaryDisplay(double* outValues)
{
    if (!outValues) return false;
    outValues[0] = 0;
    outValues[1] = 0;
    outValues[2] = GetSystemMetrics(SM_CXSCREEN);
    outValues[3] = GetSystemMetrics(SM_CYSCREEN);
    RECT wa;
    if (SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0)) {
        outValues[4] = wa.left;
        outValues[5] = wa.top;
        outValues[6] = wa.right - wa.left;
        outValues[7] = wa.bottom - wa.top;
    } else {
        outValues[4] = 0;
        outValues[5] = 0;
        outValues[6] = outValues[2];
        outValues[7] = outValues[3];
    }
    outValues[8] = 1.0;
    return true;
}

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

#endif // OS(WINDOWS)
