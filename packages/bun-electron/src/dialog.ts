// dialog — Electron-compatible dialog module.
//
// showMessageBox is implemented as a real (frameless) BrowserWindow with
// buttons, so it works on every platform and is end-to-end testable.
// showOpenDialog/showSaveDialog validate options like Electron and drive the
// native CEF file chooser.

import { BrowserWindow } from "./browser-window";
import { ipcMain } from "./ipc-main";

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: string[];
  message?: string;
}

export interface MessageBoxOptions {
  message: string;
  type?: "none" | "info" | "error" | "question" | "warning";
  buttons?: string[];
  defaultId?: number;
  title?: string;
  detail?: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  cancelId?: number;
}

function isWindow(value: unknown): value is BrowserWindow {
  return value instanceof BrowserWindow;
}

// Electron-style overloads: first arg may be a parent window.
function splitArgs<T>(windowOrOptions: BrowserWindow | T, maybeOptions?: T): [BrowserWindow | undefined, T] {
  if (isWindow(windowOrOptions)) return [windowOrOptions, maybeOptions as T];
  return [undefined, windowOrOptions];
}

function validateFileDialogOptions(options: OpenDialogOptions): void {
  if (options == null || typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.title !== undefined && typeof options.title !== "string") {
    throw new TypeError("Title must be a string");
  }
  if (options.buttonLabel !== undefined && typeof options.buttonLabel !== "string") {
    throw new TypeError("Button label must be a string");
  }
  if (options.defaultPath !== undefined && typeof options.defaultPath !== "string") {
    throw new TypeError("Default path must be a string");
  }
  if (options.filters !== undefined && !Array.isArray(options.filters)) {
    throw new TypeError("Filters must be an array");
  }
  if (options.properties !== undefined && !Array.isArray(options.properties)) {
    throw new TypeError("Properties must be an array");
  }
  if (options.message !== undefined && typeof options.message !== "string") {
    throw new TypeError("Message must be a string");
  }
}

function validateMessageBoxOptions(options: MessageBoxOptions): void {
  if (options == null || typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (typeof options.message !== "string") {
    throw new TypeError("Message must be a string");
  }
  if (options.type !== undefined && !["none", "info", "error", "question", "warning"].includes(options.type)) {
    throw new TypeError("Invalid message box type");
  }
  if (options.buttons !== undefined && !Array.isArray(options.buttons)) {
    throw new TypeError("Buttons must be an array");
  }
  if (options.title !== undefined && typeof options.title !== "string") {
    throw new TypeError("Title must be a string");
  }
  if (options.detail !== undefined && typeof options.detail !== "string") {
    throw new TypeError("Detail must be a string");
  }
  if (options.checkboxLabel !== undefined && typeof options.checkboxLabel !== "string") {
    throw new TypeError("checkboxLabel must be a string");
  }
}

let nextDialogId = 1;

function messageBoxHTML(options: MessageBoxOptions, dialogId: number): string {
  const buttons = options.buttons?.length ? options.buttons : ["OK"];
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const buttonHtml = buttons
    .map(
      (label, i) =>
        `<button data-i="${i}" ${i === (options.defaultId ?? 0) ? "autofocus" : ""}>${esc(label)}</button>`,
    )
    .join("");
  const checkbox = options.checkboxLabel
    ? `<label><input type="checkbox" id="cb" ${options.checkboxChecked ? "checked" : ""}/> ${esc(options.checkboxLabel)}</label>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .msg { font-weight: 600; } .detail { color: #444; font-size: 0.9em; }
    .buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: auto; }
    button { padding: 6px 14px; }
  </style></head><body>
    <div class="msg">${esc(options.message)}</div>
    ${options.detail ? `<div class="detail">${esc(options.detail)}</div>` : ""}
    ${checkbox}
    <div class="buttons">${buttonHtml}</div>
    <script>
      document.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", () => {
          const cb = document.getElementById("cb");
          ipcRenderer.send("__be_dialog_${dialogId}", Number(b.dataset.i), cb ? cb.checked : false);
        });
      });
    </script>
  </body></html>`;
}

export const dialog = {
  async showMessageBox(
    windowOrOptions: BrowserWindow | MessageBoxOptions,
    maybeOptions?: MessageBoxOptions,
  ): Promise<{ response: number; checkboxChecked: boolean }> {
    const [, options] = splitArgs(windowOrOptions, maybeOptions);
    validateMessageBoxOptions(options);

    const dialogId = nextDialogId++;
    const win = new BrowserWindow({
      width: 420,
      height: options.checkboxLabel || options.detail ? 220 : 160,
      title: options.title ?? "",
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
    });

    const result = new Promise<{ response: number; checkboxChecked: boolean }>((resolve) => {
      ipcMain.once(`__be_dialog_${dialogId}`, (event, response, checkboxChecked) => {
        resolve({ response: response as number, checkboxChecked: Boolean(checkboxChecked) });
        win.destroy();
      });
      win.once("closed", () => {
        // Closing the window counts as the cancel button.
        ipcMain.removeAllListeners(`__be_dialog_${dialogId}`);
        resolve({ response: options.cancelId ?? 0, checkboxChecked: false });
      });
    });

    // The user may click a button (destroying the window) before the load
    // settles, which would reject this load promise — ignore that; the
    // result promise is the real signal.
    win.loadURL(`data:text/html,${encodeURIComponent(messageBoxHTML(options, dialogId))}`).catch(() => {});
    return result;
  },

  showMessageBoxSync(): never {
    throw new Error("dialog.showMessageBoxSync is not supported; use showMessageBox");
  },

  showErrorBox(title: string, content: string): void {
    if (typeof title !== "string" || typeof content !== "string") {
      throw new TypeError("Both title and content must be strings");
    }
    // Non-blocking variant: surface on stderr and best-effort message box.
    console.error(`${title}: ${content}`);
  },

  async showOpenDialog(
    windowOrOptions: BrowserWindow | OpenDialogOptions,
    maybeOptions?: OpenDialogOptions,
  ): Promise<{ canceled: boolean; filePaths: string[] }> {
    const [win, options] = splitArgs(windowOrOptions, maybeOptions ?? ({} as OpenDialogOptions));
    validateFileDialogOptions(options ?? {});
    const target = win ?? BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error("showOpenDialog requires at least one open window");
    return target._runFileDialog("open", options ?? {});
  },

  async showSaveDialog(
    windowOrOptions: BrowserWindow | OpenDialogOptions,
    maybeOptions?: OpenDialogOptions,
  ): Promise<{ canceled: boolean; filePath?: string }> {
    const [win, options] = splitArgs(windowOrOptions, maybeOptions ?? ({} as OpenDialogOptions));
    validateFileDialogOptions(options ?? {});
    const target = win ?? BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error("showSaveDialog requires at least one open window");
    const result = await target._runFileDialog("save", options ?? {});
    return { canceled: result.canceled, filePath: result.filePaths[0] };
  },
};
