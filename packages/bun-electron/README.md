# bun-electron

Electron-compatible desktop apps powered by **Bun** and the **Chromium Embedded
Framework (CEF)** — the main process is `bun` instead of Node.js, and windows
are real Chromium, like Electron.

```ts
import { app, BrowserWindow, ipcMain } from "bun-electron";

ipcMain.handle("ping", () => "pong");

await app.whenReady();
const win = new BrowserWindow({ width: 800, height: 600 });
await win.loadURL("https://bun.com");
```

## Status

| Platform        | Build         | Runtime            | Tests                               |
| --------------- | ------------- | ------------------ | ----------------------------------- |
| Linux x64/arm64 | ✅            | ✅                 | ✅ 245 ported Electron tests passing |
| macOS x64/arm64 | ✅ (untested) | needs verification | —                                   |
| Windows x64     | ✅ (untested) | needs verification | —                                   |

The Linux build runs the full ported test suite (subsets of Electron's
`api-browser-window-spec`, `api-web-contents-spec`, `api-ipc-main-spec`,
`api-app-spec`, and `api-context-bridge-spec`, plus preload coverage)
headlessly under Xvfb. macOS and Windows code paths are
written but have not been exercised yet.

## Architecture

```
┌────────────────────────────┐      ┌──────────────────────────────┐
│ main process: bun          │      │ CEF subprocesses             │
│  your main.js              │      │  (bun-electron-helper)       │
│  src/*.ts (app, window,    │      │  renderer / gpu / utility    │
│            ipcMain)        │      │                              │
│      │ bun:ffi             │      │  helper_main.cpp injects     │
│  libbun_electron_shim      │◄────►│  ipcRenderer V8 bindings     │
│  (shim.cpp, C ABI over     │ CEF  │  into every page             │
│   CEF C++ API + Views)     │ IPC  │                              │
└────────────────────────────┘      └──────────────────────────────┘
```

- **Native shim** (`native/shim.cpp`): a flat C ABI (`be_init`,
  `be_window_create`, `be_poll_events`, …) that Bun loads via `bun:ffi`.
  Windows are created with the **CEF Views framework** (Alloy runtime style),
  which is pure cross-platform CEF API — no per-OS window code.
- **Helper executable** (`native/helper_main.cpp`): every CEF subprocess runs
  this binary (`browser_subprocess_path`). In renderers it installs
  `__be_send` / `__be_invoke` native functions and evaluates
  `renderer_bootstrap.h`, which builds the `ipcRenderer` API.
- **TypeScript layer** (`src/`): Electron-compatible `app`, `BrowserWindow`,
  `webContents`, `ipcMain`, `shell` on top of the FFI.
- **Events** flow native→JS through a JSON queue drained on a 2ms timer
  (single cheap FFI call when idle).
- **Threading**: on Linux/Windows CEF runs its own multi-threaded message
  loop, so Bun's event loop is never blocked; shim commands marshal to the
  CEF UI thread internally. On macOS CEF requires the UI loop on the process
  main thread, so the shim uses `external_message_pump` and the JS side
  drives `CefDoMessageLoopWork()` from the same timer.
- **IPC**: `ipcRenderer.send/invoke` → `CefProcessMessage` → shim event →
  `ipcMain`. Replies and `webContents.send` travel the same road in reverse.
  Arguments are JSON-serialized (structured-clone types beyond JSON are not
  supported yet).

## Building

Requires CMake 3.21+, a C++20 compiler, and ~1.5GB disk for the CEF binary
distribution (downloaded automatically, pinned in `scripts/cef-version.ts`).

```sh
cd packages/bun-electron
bun run fetch-cef   # downloads CEF for this platform into native/.cef/
bun run build       # cmake + ninja/msbuild/xcode, assembles dist/<platform>-<arch>/
```

Then:

```sh
bun examples/hello/main.js
bun examples/ipc/main.js
```

### Linux

Tested on Amazon Linux 2023 / GCC. Needs X11 (or run under
`xvfb-run -a` headlessly). The sandbox is disabled for now (`no_sandbox`), so
`chrome-sandbox` setuid setup is not required.

### macOS (needs verification)

`bun run build` produces `dist/macos-<arch>/` containing the shim dylib, the
`Chromium Embedded Framework.framework`, and the five helper `.app` bundles
(`bun-electron Helper.app`, `… (GPU).app`, `… (Renderer)`, `… (Plugin)`,
`… (Alerts)`). The shim loads the framework at runtime with
`cef_load_library()` and installs a `CefAppProtocol` NSApplication subclass,
so a plain `bun main.js` from the terminal should open windows without an app
bundle. Known caveats to verify:

- The CEF message pump is driven externally from a JS timer (cefpython-style);
  watch for input lag or missed paints.
- Unbundled browser processes can't show a proper app name/menu bar; a
  `bundle-macos` packaging step is the eventual fix.
- If window activation fails, try `open -a Terminal` first or check
  `LSUIElement` handling.

### Windows (needs verification)

Build with VS2022 (`bun run build` uses the default CMake generator when
ninja is missing). The TS layer widens the DLL search path with
`SetDllDirectoryW` before `dlopen`, since `libcef.dll` lives next to the shim
rather than next to `bun.exe`. Events are polled on a timer (no pipe fd on
Windows). The sandbox is disabled (CEF's Windows sandbox requires hooking the
executable's startup, which we can't do from inside bun).

## API coverage

Implemented (Electron-compatible subset):

- `app`: `whenReady`, `isReady`, `quit`, `exit`, `getName`/`setName`,
  `getPath` (partial), `commandLine.appendSwitch`, events `ready`,
  `window-all-closed` (with Electron's default-quit semantics),
  `before-quit`, `will-quit`, `quit`.
- `BrowserWindow`: constructor options (`width/height/x/y/show/title/
resizable/minimizable/maximizable/fullscreen/alwaysOnTop/frame/
backgroundColor`), `loadURL`/`loadFile` (promise-returning, rejects on
  failed loads), `close`/`destroy`/`show`/`hide`/`focus`/`minimize`/
  `maximize`/`restore`/`center`, `setTitle`/`getTitle`,
  bounds/size/position get+set, `isVisible`/`isMinimized`/`isMaximized`/
  `isFullScreen`/`isFocused`/`isDestroyed`, `setFullScreen`,
  `setAlwaysOnTop`, statics `getAllWindows`/`fromId`/`getFocusedWindow`,
  events `ready-to-show`, `close`, `closed`, `focus`, `blur`, `resize`,
  `move`, `page-title-updated`, `enter-full-screen`, `leave-full-screen`.
- `webContents`: `send`, `executeJavaScript` (resolves the completion value,
  follows promises, rejects on page exceptions), `getURL`, `getTitle`,
  `openDevTools`/`closeDevTools`, `reload`, `stop`, `goBack`/`goForward`,
  `setZoomLevel`, events `did-finish-load`, `did-fail-load`, `dom-ready`,
  `did-navigate`, `console-message`.
- `ipcMain`: `on`/`once`/`removeListener`, `handle`/`handleOnce`/
  `removeHandler`, `event.reply`, `event.sender`.
- Renderer: `ipcRenderer.send/invoke/on/once/removeListener`, exposed as
  `globalThis.ipcRenderer`, `globalThis.bunElectron`, and a
  `require('electron')` shim.
- **Preload scripts** (`webPreferences.preload`): run in every new main-frame
  context after the bootstrap and before page scripts, with `ipcRenderer` and
  `contextBridge` available (source travels via CEF `extra_info`).
- **`contextBridge.exposeInMainWorld(name, api)`** (renderers run without
  context isolation, so this binds a read-only global).
- **`capturePage()`** on windows and webContents: PNG screenshot through the
  DevTools protocol (`Page.captureScreenshot`), returns a minimal
  `NativeImage` (`toPNG()`, `isEmpty()`).
- **`window.open()`**: popups are tracked as real `BrowserWindow`s; the
  opener's webContents emits `did-create-window`.
- Window sizing constraints: `minWidth`/`minHeight`/`maxWidth`/`maxHeight`
  options, `setMinimumSize`/`setMaximumSize`/`setResizable`/`setMinimizable`/
  `setMaximizable` + getters.
- `webContents.insertCSS`/`removeInsertedCSS`/`isLoading`.
- `app.getAppPath`, `app.getLocale`, `browser-window-created` event.
- `shell.openExternal/openPath` (scheme-validated).
- **`ipcRenderer.sendSync`** (synchronous IPC via a custom `beipc://` scheme
  answered by the main process) and `event.returnValue`.
- **Structured-clone IPC arguments**: `Date`, `RegExp`, `Map`, `Set`,
  `ArrayBuffer`, typed arrays, `BigInt`, `undefined`, `NaN`/`Infinity`/`-0`
  survive both directions (a serializer shared between `src/serialize.ts` and
  the renderer bootstrap).
- **`Menu`/`MenuItem`**: template building, submenus, roles, checkbox/radio
  groups, `getMenuItemById`, application-menu registry (data model only; OS
  menu-bar rendering is not wired up).
- **`nativeImage`**: `createFromPath`/`createFromBuffer`/`createFromDataURL`/
  `createEmpty`, `toPNG`/`toDataURL`/`getSize`/`getAspectRatio` (PNG & JPEG
  header parsing; no raster ops).
- **`dialog`**: `showMessageBox` (rendered as a real window, fully working),
  `showOpenDialog`/`showSaveDialog` (native CEF file chooser), `showErrorBox`,
  with Electron's option validation.
- **`screen`**: `getPrimaryDisplay`/`getAllDisplays` via CEF `CefDisplay`.
- **`session.defaultSession.cookies`**: `get`/`set`/`remove` via CEF's
  `CefCookieManager`.
- **`protocol`**: `registerSchemesAsPrivileged`, `handle`/`unhandle`/
  `isProtocolHandled` — custom schemes served by JS handlers (returns
  `Response` objects or `{data, mimeType, statusCode}`), backed by a CEF
  scheme handler factory.
- **Window icons**: `BrowserWindow.setIcon` (PNG → `CefImage`).
- **`webContents.printToPDF`** and **`setUserAgent`/`getUserAgent`** via the
  DevTools protocol (`Page.printToPDF`, `Network.setUserAgentOverride`).
- **`safeStorage`**: `encryptString`/`decryptString`/`isEncryptionAvailable`,
  real AES-256-GCM with a per-user key file (the OS-keychain backend Electron
  uses is the only difference).
- **`clipboard`**: text/HTML/RTF/bookmark read+write, `availableFormats`,
  `has`, `clear` (process-local store — no system clipboard on headless CI).
- **`globalShortcut`**: register/unregister/isRegistered with Electron's
  accelerator parsing and `CommandOrControl` resolution (registry only; no OS
  key capture).
- **`Tray`**, **`Notification`**: data models with events (no OS rendering).
- **`net`**: `net.fetch` and `net.request` (a Node `http.ClientRequest`-shaped
  client over the runtime's fetch) with `response`/`data`/`end`/`error`
  events.
- **`MessageChannelMain`/`MessagePortMain`**: real in-process entangled ports
  with `postMessage`/`start`/`close`, buffering, and port transfer.
- **`powerMonitor`**: `getSystemIdleState`/`getSystemIdleTime`/
  `isOnBatteryPower`/`getCurrentThermalState` and power-event listeners.
- **`contextIsolation`** (`webPreferences.contextIsolation: true`): the
  preload runs in an isolated scope — its `window`/global writes stay
  invisible to the page, `ipcRenderer`/`contextBridge` are not page globals,
  and only `contextBridge.exposeInMainWorld` values cross into the page. The
  preload still reads through to the real DOM and reaches the main process
  over IPC. (Default is non-isolated, unlike Electron, so existing
  `nodeIntegration`-style renderers keep working.)

`Menu.popup()` renders a real native (OS-drawn) menu via CEF's Views
`ShowMenu`, verified under Xvfb by the native menu popup appearing as an X11
window. Still data-model / process-local (no OS surface): `Tray` icon and
`Notification` display (need an X11 systray host / notification daemon, absent
headless), `clipboard` (no system clipboard), `globalShortcut` key capture.

Not implemented (each blocked by a missing CEF API, no headless test surface,
or hardware): real OS power-event delivery; OS-native rendering of
menus/tray/notifications; progressive-JPEG decode
(baseline JPEG and all PNG variants are supported); and macOS/Windows
execution (code paths exist, unverified without that hardware).

Context isolation is implemented at the JS-scope level (observable Electron
semantics), not via a separate Chromium V8 world — sufficient for the API
contract, but not the same defense-in-depth as Chrome's isolated worlds.

## Testing

```sh
cd packages/bun-electron
bun run build
xvfb-run -a bun test test/     # linux headless; on macOS just: bun test test/
```

Tests are ported from Electron's spec suite (names preserved where behavior
carries over): `browser-window`, `web-contents`, `ipc`, `app`, `preload`,
`menu`, `native-image`, `dialog`, `screen`, `session`, `protocol`,
`window-icon`, `safe-storage`, `clipboard`, `global-shortcut`,
`tray-notification`, `net`, `message-channel`, `power-monitor`,
`context-isolation`, `web-request`, `desktop-capturer`, `png-decode`, and
`jpeg-decode`, `native-theme`, `app-extras`, `power-save-blocker`, and
`system-preferences`, `power-save-blocker`, `desktop-capturer`, `utility-process`, and `menu-render` test files (245 tests total). App-lifecycle scenarios spawn fresh
bun processes per test (CEF initializes once per process); everything else
shares one CEF instance across the suite.

## Debugging

- `BUN_ELECTRON_TRACE=1` — log every native event to stderr.
- `BUN_ELECTRON_SWITCHES=disable-gpu,enable-logging` — extra Chromium
  switches.
- `BUN_ELECTRON_DEBUG_PORT=9222` — Chrome DevTools protocol on a port.
- `BUN_ELECTRON_LOG_FILE=/tmp/cef.log` — CEF log destination.
- `win.webContents.openDevTools()` — DevTools window.
