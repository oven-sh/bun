const fs = require("node:fs");
const path = require("node:path");
const native = require("internal/desktop/native");
const { app, hasDisplay } = require("internal/desktop/app");
const { Window, kInternal, kSurface } = require("internal/desktop/window");

type Options = Record<string, any>;

const isMac = process.platform === "darwin";
let nextMessageBox = 1;

function parameters(window: any, options?: Options): [any, Options] {
  return window instanceof Window ? [window, options ?? {}] : [undefined, options ?? window ?? {}];
}

function withoutNul(name: string, value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string") throw $ERR_INVALID_ARG_TYPE(name, "string", value);
  if (value.includes("\0")) throw $ERR_INVALID_ARG_VALUE(name, value, "must not contain null bytes");
  return value;
}

function fileOptions(save: boolean, ...given: [any, Options?]) {
  const [window, options] = parameters(...given);
  const properties: string[] = options.properties ?? [];
  let directory = withoutNul("defaultPath", options.defaultPath);
  let fileName: string | undefined;
  if (directory && !fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    fileName = path.basename(directory);
    directory = directory === fileName ? undefined : path.dirname(directory);
  }
  native.start();
  if (!hasDisplay()) throw new Error("There is no display server to show a dialog on");
  const directories = properties.includes("openDirectory");
  return {
    window: window?.id,
    title: withoutNul("title", options.title ?? (isMac ? undefined : options.message)),
    message: withoutNul("message", options.message),
    buttonLabel: withoutNul("buttonLabel", options.buttonLabel),
    showsHiddenFiles: properties.includes("showHiddenFiles"),
    keepsAliases: properties.includes("noResolveAliases"),
    entersPackages: properties.includes("treatPackageAsDirectory"),
    directory: directory && path.resolve(directory),
    fileName,
    filters: (options.filters ?? []).map(({ name, extensions }) => ({
      name: withoutNul("filters.name", name),
      extensions: extensions.map(extension => withoutNul("filters.extensions", extension)),
    })),
    save,
    files: properties.includes("openFile") || !directories,
    directories,
    multiple: properties.includes("multiSelections"),
    createDirectories: save || properties.includes("createDirectory"),
  };
}

async function showOpenDialog(window: any, options?: Options) {
  const filePaths = await native.request("pickFiles", fileOptions(false, window, options));
  return { canceled: filePaths === null, filePaths: filePaths ?? [] };
}

function showOpenDialogSync(window: any, options?: Options) {
  return native.requestSync("pickFiles", fileOptions(false, window, options)) ?? undefined;
}

async function showSaveDialog(window: any, options?: Options) {
  const filePaths = await native.request("pickFiles", fileOptions(true, window, options));
  return { canceled: filePaths === null, filePath: filePaths?.[0] ?? "" };
}

function showSaveDialogSync(window: any, options?: Options) {
  return native.requestSync("pickFiles", fileOptions(true, window, options))?.[0] ?? "";
}

function messageOptions(...given: [any, Options?]): Options {
  const [window, options] = parameters(...given);
  const buttons: string[] = options.buttons?.length ? options.buttons.map(String) : ["OK"];
  const cancel = buttons.findIndex(label => /^(?:cancel|no)$/i.test(label));
  return {
    ...options,
    window,
    message: String(options.message ?? ""),
    buttons,
    defaultId: options.defaultId ?? 0,
    cancelId: options.cancelId ?? Math.max(cancel, 0),
  };
}

/** Linux has no alerts. */
function isNative(options: Options) {
  if (process.platform === "linux" || native.options.headless) return false;
  return isMac || (options.window?.isVisible() && !options.checkboxLabel && !options.signal);
}

const nativeOptions = ({ window, type, message, detail, buttons, defaultId, cancelId, ...options }: Options) => ({
  id: nextMessageBox++,
  window: window?.id,
  type,
  message,
  detail,
  buttons,
  defaultId,
  cancelId,
  checkboxLabel: options.checkboxLabel,
  checkboxChecked: !!options.checkboxChecked,
});

const WIDTH = 420;
const style = `
body{display:flex;flex-direction:column;gap:16px;padding:20px}
main{display:flex;gap:14px}
i{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;color:#fff;background:AccentColor;
  font:700 20px system-ui}
i:empty{display:none}
.warning{background:#d97706}
.error{background:#dc2626}
div{min-width:0;user-select:text;white-space:pre-wrap;overflow-wrap:anywhere}
h1{margin:0;font-size:15px;font-weight:600}
p{margin:4px 0 0;opacity:.8}
label{display:flex;align-items:center;gap:6px}
footer{display:flex;flex-flow:row-reverse wrap;gap:8px}
button{min-width:72px;padding:5px 12px;border-radius:6px;font:inherit}`;
const symbols = { __proto__: null, info: "i", question: "?", warning: "!", error: "!" };

function fillMessageWindow(window: any, options: Options, result: { response: number; checkboxChecked: boolean }) {
  const { document } = window;
  const find = (selector: string) => document.querySelector(selector);
  window.insertCSS(style);
  document.body.innerHTML = `<main role=alertdialog><i></i><div><h1></h1><p></p></div></main>
    <label><input type=checkbox></label><footer></footer>`;
  find("main").ariaLabel = find("h1").textContent = options.message;
  find("i").textContent = symbols[options.type] ?? "";
  find("i").className = options.type ?? "";
  find("p").textContent = options.detail ?? "";
  find("p").hidden = !options.detail;
  find("input").checked = result.checkboxChecked;
  find("input").onchange = event => (result.checkboxChecked = event.target.checked);
  const { checkboxLabel } = options;
  if (checkboxLabel) find("label").append(checkboxLabel);
  else find("label").remove();
  options.buttons.forEach((label: string, index: number) => {
    const button = find("footer").appendChild(document.createElement("button"));
    button.textContent = label.replace(/&(&?)/g, "$1");
    button.onclick = () => {
      result.response = index;
      window.destroy();
    };
    if (index === options.defaultId) button.focus();
  });
  document.onkeydown = event => event.key === "Escape" && window.destroy();
  window.setContentSize(WIDTH, Math.ceil(document.body.getBoundingClientRect().bottom));
}

function openMessageWindow(options: Options, done: (result: { response: number; checkboxChecked: boolean }) => void) {
  const window = new Window({
    title: options.title ?? app.name,
    width: WIDTH,
    height: 150,
    parent: options.window,
    modal: true,
    resizable: false,
    minimizable: false,
    autoHideMenuBar: true,
    [kInternal]: true,
  });
  const result = { response: options.cancelId, checkboxChecked: !!options.checkboxChecked };
  const abort = () => window.destroy();
  options.signal?.addEventListener("abort", abort);
  window.once("closed", () => {
    options.signal?.removeEventListener("abort", abort);
    done(result);
  });
  fillMessageWindow(window, options, result);
  return window;
}

async function showMessageBox(window: any, givenOptions?: Options) {
  const options = messageOptions(window, givenOptions);
  if (options.signal?.aborted) return { response: options.cancelId, checkboxChecked: !!options.checkboxChecked };
  if (!isNative(options)) return new Promise(resolve => openMessageWindow(options, resolve));
  native.start();
  const shown = nativeOptions(options);
  const close = () => native.send("closeMessageBox", shown.id);
  options.signal?.addEventListener("abort", close);
  if (isMac) options.window?.once("closed", close);
  const [response, checkboxChecked] = await native.request("messageBox", shown);
  options.signal?.removeEventListener("abort", close);
  options.window?.off("closed", close);
  return { response: response ?? options.cancelId, checkboxChecked };
}

function showMessageBoxSync(window: any, givenOptions?: Options): number {
  const options = messageOptions(window, givenOptions);
  if (isNative(options)) {
    native.start();
    return native.requestSync("messageBox", nativeOptions(options))[0] ?? options.cancelId;
  }
  let response: number | undefined;
  const box = openMessageWindow(options, result => (response = result.response));
  native.waitUntil(
    () => response !== undefined,
    event => event.w === box.id || event.s === box[kSurface],
    surface => surface === box[kSurface],
  );
  return response!;
}

function showErrorBox(title: string, content: string) {
  native.start();
  if (!hasDisplay() || native.options.headless) return console.error(`${title}\n${content}`);
  showMessageBoxSync(Window.getFocusedWindow(), { type: "error", message: title, detail: content });
}

export default {
  showOpenDialog,
  showOpenDialogSync,
  showSaveDialog,
  showSaveDialogSync,
  showMessageBox,
  showMessageBoxSync,
  showErrorBox,
};
