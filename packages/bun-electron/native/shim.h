// bun-electron native shim: flat C ABI consumed from Bun via bun:ffi.
//
// Threading model:
//  - Linux/Windows: CEF runs a multi-threaded message loop. All be_* command
//    functions may be called from the JS thread; they marshal work to the CEF
//    UI thread internally.
//  - macOS: CEF requires the UI loop on the process main thread (which is
//    also Bun's JS thread), so we use external_message_pump=1 and the JS side
//    drives be_do_message_loop_work() from a timer plus pump-schedule events.
//
// Events flow one way, native -> JS, through a queue drained with
// be_poll_events(). Each event is a JSON object; be_poll_events returns a
// JSON array of all pending events. A byte is written to the notification
// pipe (be_get_event_fd) whenever the queue transitions from empty to
// non-empty, so JS can sleep on the fd instead of polling.
//
// String arguments use a simple "key=value\n" format where values are
// percent-encoded (%XX) so they can contain arbitrary characters.

#ifndef BUN_ELECTRON_SHIM_H
#define BUN_ELECTRON_SHIM_H

#include <stdint.h>

#if defined(_WIN32)
#define BE_EXPORT __declspec(dllexport)
#else
#define BE_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

// macOS only: load the CEF framework before any other call.
// Returns 1 on success. No-op (returns 1) on other platforms.
BE_EXPORT int be_load_library(const char *framework_path);

// Initialize CEF. kv keys: subprocess_path, resources_dir, locales_dir,
// cache_dir, framework_dir (mac), external_pump (0/1), log_file,
// log_severity, remote_debugging_port, switch (repeatable, e.g. disable-gpu).
// Returns 0 on success, non-zero CEF exit code style error otherwise.
BE_EXPORT int be_init(const char *kv);

// Returns the read end of the event-notification pipe, or -1 when
// unavailable (Windows): fall back to timer polling.
BE_EXPORT int be_get_event_fd(void);

// Drain all pending events. Returns a malloc'd JSON array string (possibly
// "[]"), or NULL when nothing is pending. Free with be_free().
BE_EXPORT char *be_poll_events(void);
BE_EXPORT void be_free(char *p);

// Create a window. Returns the new window id (>0) immediately; the actual
// CEF window is created asynchronously on the UI thread and a
// "window-created" event fires when ready. kv keys: url, title, width,
// height, x, y, show, resizable, frameless, fullscreen, always_on_top,
// min_width, min_height, max_width, max_height, background_color (AARRGGBB
// hex).
BE_EXPORT int32_t be_window_create(const char *kv);

// Generic window command. cmd is one of: show, hide, close, destroy, focus,
// minimize, maximize, restore, center, set_title, set_bounds (kv arg:
// x,y,width,height — any subset), set_fullscreen (arg "1"/"0"),
// set_always_on_top (arg "1"/"0"), load_url (arg url), open_devtools,
// close_devtools, reload, stop, go_back, go_forward, set_zoom (arg level).
// arg may be NULL.
BE_EXPORT void be_window_command(int32_t id, const char *cmd, const char *arg);

// Synchronous window state from the shim-side cache (updated on UI-thread
// events). Returns malloc'd JSON object {x,y,width,height,visible,focused,
// minimized,maximized,fullscreen,title,url} or NULL if no such window.
BE_EXPORT char *be_window_get_state(int32_t id);

// Capture a PNG screenshot of the page via the DevTools protocol. Emits a
// {"type":"capture-result","captureId":N,"success":bool,"result":{...}}
// event where result.data is base64 PNG on success.
BE_EXPORT void be_capture_page(int32_t id, int32_t capture_id);

// Inject a synthetic input event. kv keys: type (char/keyDown/keyUp/
// rawKeyDown/mouseDown/mouseUp/mouseMove), x, y, button, keyCode, character,
// modifiers, clickCount.
BE_EXPORT void be_send_input_event(int32_t id, const char *kv);

// Native window handle (X11 Window on Linux), or 0 if not yet created.
BE_EXPORT uint64_t be_window_get_handle(int32_t id);

// Execute JavaScript in the window's main frame. If eval_id > 0 the result
// round-trips through the renderer and an {"type":"eval-result","evalId":N,
// "result":...,"isError":bool} event fires; with eval_id == 0 it's
// fire-and-forget.
BE_EXPORT void be_window_eval_js(int32_t id, const char *code, int32_t eval_id);

// Send an IPC message to the window's renderer (ipcRenderer.on receives it).
// args_json must be a JSON array string.
BE_EXPORT void be_ipc_send(int32_t id, const char *channel,
                           const char *args_json);

// Reply to an ipcRenderer.invoke() call.
BE_EXPORT void be_ipc_reply(int32_t id, int32_t invoke_id,
                            const char *result_json, int32_t is_error);

// macOS external pump: perform one unit of message-loop work.
BE_EXPORT void be_do_message_loop_work(void);

// Ask CEF to exit. After all windows close and CEF winds down, a "quit"
// event fires; then call be_shutdown().
BE_EXPORT void be_quit(void);

// Final CEF shutdown. Call once, after be_quit, right before process exit.
BE_EXPORT void be_shutdown(void);

// Enumerate native top-level windows for desktopCapturer's "window" sources.
// Linux/X11 only; returns a malloc'd JSON array
// [{"xid":N,"title":"...","width":W,"height":H}] (free with be_free), or NULL
// where enumeration is unavailable.
BE_EXPORT char *be_enumerate_windows(void);

// Capture a native window's pixels by X11 id. Returns malloc'd JSON
// {"width":W,"height":H,"data":"<base64 RGBA>"} (free with be_free), or NULL
// on failure / unsupported platform.
BE_EXPORT char *be_capture_window(uint32_t xid);

// Version string of the shim + underlying CEF, malloc'd; free with be_free.
BE_EXPORT char *be_version(void);

#ifdef __cplusplus
} // extern "C"
#endif

#endif // BUN_ELECTRON_SHIM_H
