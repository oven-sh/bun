require("internal/desktop/native").prewarmIfPackaged();

// The globals of Bun that the window has its own of. A compiled program may only replace the ones that are spelled out.
const global: any = globalThis;
delete global.addEventListener;
delete global.alert;
delete global.confirm;
delete global.CustomEvent;
delete global.dispatchEvent;
delete global.ErrorEvent;
delete global.Event;
delete global.EventTarget;
delete global.FormData;
delete global.navigator;
delete global.onerror;
delete global.onmessage;
delete global.postMessage;
delete global.prompt;
delete global.removeEventListener;
delete global.reportError;
delete global.self;

const { window, document } = require("internal/desktop/host").installGlobals();

export default { window, document };
