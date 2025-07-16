// This file implements the UI for error modals. Since using a framework like
// React could collide with the user's code (consider React DevTools), this
// entire modal is written from scratch using the standard DOM APIs. All CSS is
// scoped in `overlay.css`, and all elements exist under a shadow root. These
// constraints make the overlay very simple to understand and work on.
//
// This file has two consumers:
// - The bundler error page which embeds a list of bundler errors to render.
// - The client runtime, for when reloading errors happen.
// Both use a WebSocket to coordinate followup updates, when new errors are
// added or previous ones are solved.
if (side !== "client") throw new Error("Not client side!");
// NOTE: imports are at the bottom for readability

/** When set, the next successful build will reload the page. */
export let hasFatalError = false;

/**
 * 32-bit integer corresponding to `SerializedFailure.Owner.Packed`
 * It is never decoded client-side.
 */
type FailureOwner = number;

/**
 * Build errors come from SerializedFailure objects on the server, with the key
 * being the the SerializedFailure.Owner bitcast to an i32.
 */
const buildErrors = new Map<FailureOwner, DeserializedFailure>();
/** Runtime errors are stored in a list and are cleared before any hot update. */
const runtimeErrors: RuntimeError[] = [];
const errorDoms = new Map<FailureOwner, ErrorDomNodes>();
const updatedErrorOwners = new Set<FailureOwner>();

/**
 * -1  => All build errors
 * 0.. => Runtime error by index
 */
let activeErrorIndex = -1;
let lastActiveErrorIndex = -1;
let needUpdateNavbar = false;

let domShadowRoot: HTMLElement;
let domModalTitle: HTMLElement;
let domErrorContent: HTMLElement;
/** For build errors */
let domFooterText: HTMLElement;
/** For runtime errors */
let domNavBar: {
  root: HTMLElement;
  active: HTMLElement;
  total: HTMLElement;
  label: Text;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  dismissAllBtn: HTMLButtonElement;
} = {} as any;

// I would have used JSX, but TypeScript types interfere in odd ways. However,
// this pattern allows concise construction of DOM nodes, but also extremely
// simple capturing of referenced nodes. Consider:
//      let title;
//      const btn = elem("button", { class: "file-name" }, [(title = textNode())]);
// Now you can edit `title.textContent` freely.
function elem<T extends keyof HTMLElementTagNameMap>(
  tagName: T,
  props?: null | Record<string, string>,
  children?: Node[],
) {
  const node = document.createElement(tagName);
  if (props)
    for (let key in props) {
      node.setAttribute(key, props[key]);
    }
  if (children)
    for (const child of children) {
      node.appendChild(child);
    }
  return node;
}

function elemText<T extends keyof HTMLElementTagNameMap>(
  tagName: T,
  props: null | Record<string, string>,
  innerHTML: string,
) {
  const node = document.createElement(tagName);
  if (props)
    for (let key in props) {
      node.setAttribute(key, props[key]);
    }
  node.textContent = innerHTML;
  return node;
}

const textNode = (str = "") => document.createTextNode(str);

interface ErrorDomNodes {
  root: HTMLElement;
  fileName: Text;
  messages: HTMLElement[];
}

interface RuntimeError {
  /** error.name */
  name: string;
  /** error.message */
  message: string;
  /** error.stack after remapping */
  trace: RemappedFrame[];
  /** When the `fetch` request fails or takes too long */
  remapped: boolean;
  /** Promise rejection */
  async: boolean;

  code?: CodePreview;
}

interface CodePreview {
  lines: string[];
  col: number;
  loi: number;
  len: number;
  firstLine: number;
}

interface RemappedFrame extends Frame {}

declare const OVERLAY_CSS: string;
/**
 * Initial mount is done lazily. The modal starts invisible, controlled
 * by `setModalVisible`.
 */
function mountModal() {
  if (domModalTitle) return;
  domShadowRoot = elem("bun-hmr", {
    style:
      "position:fixed!important;" +
      "display:none!important;" +
      "top:0!important;" +
      "left:0!important;" +
      "width:100%!important;" +
      "height:100%!important;" +
      "background:#8883!important;" +
      "z-index:2147483647!important",
  });
  const shadow = domShadowRoot.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replace(OVERLAY_CSS);
  shadow.adoptedStyleSheets = [sheet];

  const root = elem("div", { class: "root" }, [
    elem("div", { class: "modal" }, [
      // Runtime errors get a switcher to toggle between each runtime error and
      // the build errors. This is done because runtime errors are very big.
      // Only visible when a runtime error is present.
      (domNavBar.root = elem("nav", null, [
        // TODO: use SVG for this
        (domNavBar.prevBtn = elemText(
          "button",
          { class: "tab-button left", disabled: "true", "aria-label": "Previous error" },
          "",
        )),
        (domNavBar.nextBtn = elemText("button", { class: "tab-button right", "aria-label": "Next error" }, "")),
        elem("span", null, [
          (domNavBar.active = elem("code")),
          textNode(" of "),
          (domNavBar.total = elem("code")),
          (domNavBar.label = textNode(" Errors")),
        ]),
        elem("div", { class: "flex" }),
        (domNavBar.dismissAllBtn = elem("button", { class: "dismiss-all", "aria-label": "Dismiss all errors" })),
      ])),
      // The active page's header
      elem("header", null, [(domModalTitle = elem("div", { class: "title" }))]),
      // The active page's content
      (domErrorContent = elem("div", { class: "error-content" })),
      elem("footer", null, [
        (domFooterText = elemText("div", null, "")),
        elem("div", { class: "flex" }),
        elemText("div", null, "Bun v" + config.bun),
      ]),
    ]),
  ]);
  domNavBar.dismissAllBtn.addEventListener("click", onDismissAllErrors);
  domNavBar.prevBtn.addEventListener("click", onPrevError);
  domNavBar.nextBtn.addEventListener("click", onNextError);
  shadow.appendChild(root);
  document.body.appendChild(domShadowRoot);
}

let isModalVisible = false;
function setModalVisible(visible: boolean) {
  if (isModalVisible === visible || !domShadowRoot) return;
  isModalVisible = visible;
  domShadowRoot.style.display = visible ? "block" : "none";
}

/** Handler for `MessageId.errors` websocket packet */
export function onServerErrorPayload(view: DataView<ArrayBuffer>) {
  const reader = new DataViewReader(view, 1);
  const removedCount = reader.u32();

  for (let i = 0; i < removedCount; i++) {
    const removed = reader.u32();
    updatedErrorOwners.add(removed);
    buildErrors.delete(removed);
  }

  while (reader.hasMoreData()) {
    decodeAndAppendServerError(reader);
  }

  updateErrorOverlay();
}

export async function onRuntimeError(err: any, fatal = false, async = false) {
  try {
    if (fatal) {
      hasFatalError = true;
    }

    // Parse the stack trace and normalize the error message.
    let name = err?.name ?? "error";
    if (name === "Error") name = "error";
    let message = err?.message;
    if (!message)
      try {
        message = JSON.stringify(err);
      } catch (e) {
        message = "[error while serializing error: " + e + "]";
      }
    else if (typeof message !== "string") {
      try {
        message = JSON.stringify(message);
      } catch (e) {
        message = "[error while serializing error message: " + e + "]";
      }
    }
    const parsed = parseStackTrace(err) ?? [];

    const browserUrl = location.href;

    // Serialize the request into a binary buffer. Pre-allocate a little above what it needs.
    let bufferLength = 3 * 4 + (name.length + message.length + browserUrl.length) * 3;
    for (const frame of parsed) {
      bufferLength += 4 * 4 + ((frame.fn?.length ?? 0) + (frame.file?.length ?? 0)) * 3;
    }
    const writer = DataViewWriter.initCapacity(bufferLength);
    writer.stringWithLength(name);
    writer.stringWithLength(message);
    writer.stringWithLength(browserUrl);
    writer.u32(parsed.length);
    for (const frame of parsed) {
      writer.u32(frame.line ?? 0);
      writer.u32(frame.col ?? 0);
      writer.stringWithLength(frame.fn ?? "");
      const fileName = frame.file;
      if (fileName) {
        writer.stringWithLength(fileName);
      } else {
        writer.u32(0);
      }
    }

    // Request the error to be reported and remapped.
    const response = await fetch("/_bun/report_error", {
      method: "POST",
      body: writer.view.buffer,
    });
    try {
      if (!response.ok) {
        throw new Error("Failed to report error");
      }
      const reader = new DataViewReader(new DataView(await response.arrayBuffer()), 0);
      const trace: Frame[] = [];
      const traceLen = reader.u32();
      for (let i = 0; i < traceLen; i++) {
        const line = reader.i32();
        const col = reader.i32();
        const fn = reader.string32();
        const file = reader.string32();
        trace.push({
          fn,
          file,
          line,
          col,
        });
      }
      let code: CodePreview | undefined;
      const codePreviewLineCount = reader.u8();
      if (codePreviewLineCount > 0) {
        const lineOfInterestOffset = reader.u32();
        const firstLineNumber = reader.u32();
        const highlightedColumn = reader.u32();
        let lines = new Array(codePreviewLineCount);
        for (let i = 0; i < codePreviewLineCount; i++) {
          const line = reader.string32();
          lines[i] = line;
        }
        const { col, len } = expandHighlight(lines[lineOfInterestOffset], highlightedColumn);
        lines = lines.map(line => syntaxHighlight(line));
        code = {
          lines,
          col,
          loi: lineOfInterestOffset,
          len,
          firstLine: firstLineNumber,
        };
      }
      runtimeErrors.push({
        name,
        message,
        trace,
        remapped: true,
        async,
        code,
      });
    } catch (e) {
      console.error("Failed to remap error", e);
      runtimeErrors.push({
        name,
        message,
        trace: parsed,
        remapped: false,
        async,
      });
    }

    needUpdateNavbar = true;
    updateErrorOverlay();
  } catch (e) {
    console.error("Failed to report error", e);
  }
}

function expandHighlight(line: string, col: number) {
  let rest = line.slice(Math.max(0, col - 1));
  let len = 1;
  len = 0;
  let prev = line.slice(0, col - 1);
  // expand forward from new
  if (rest.match(/^new\s/)) {
    len += 4;
    rest = rest.slice(4);
  }
  // expand backward from new
  const newText = prev.match(/new\s+$/)?.[0];
  if (newText) {
    len += newText.length;
    col -= newText.length;
    prev = prev.slice(0, prev.length - newText.length);
  }
  // expand backward from throw
  const throwText = prev.match(/throw\s+$/)?.[0];
  if (throwText) {
    len += throwText.length;
    col -= throwText.length;
  }
  len += (rest.match(/.\b/)?.index ?? -1) + 1;
  if (len <= 0) len = 1;
  return { col, len };
}

/**
 * Call this for each error, then call `updateErrorOverlay` to commit the
 * changes to the UI in one smooth motion.
 */
export function decodeAndAppendServerError(r: DataViewReader) {
  const owner = r.u32();
  const file = r.string32() || null;
  const messageCount = r.u32();
  const messages = new Array(messageCount);
  for (let i = 0; i < messageCount; i++) {
    messages[i] = decodeSerializedError(r);
  }
  buildErrors.set(owner, { file, messages });
  updatedErrorOwners.add(owner);

  activeErrorIndex = -1;
  needUpdateNavbar = true;
}

/**
 * Called when the list of errors changes, bundling errors change, or the active error page changes.
 */
export function updateErrorOverlay() {
  // if there are no errors, hide the modal
  const totalErrors = runtimeErrors.length + buildErrors.size;
  if (totalErrors === 0) {
    if (IS_ERROR_RUNTIME) {
      location.reload();
    } else {
      setModalVisible(false);
    }
    return;
  }
  // ensure the target page is valid
  if (activeErrorIndex === -1 && buildErrors.size === 0) {
    activeErrorIndex = 0; // there is a runtime error, else this modal will be hidden
    needUpdateNavbar = true;
  } else if (activeErrorIndex >= runtimeErrors.length) {
    needUpdateNavbar = true;
    if (activeErrorIndex === 0) {
      activeErrorIndex = -1; // there must be a build error, else this modal will be hidden
    } else {
      activeErrorIndex = runtimeErrors.length - 1;
    }
  }
  mountModal();

  if (needUpdateNavbar) {
    needUpdateNavbar = false;
    if (activeErrorIndex >= 0) {
      // Runtime errors
      const err = runtimeErrors[activeErrorIndex];
      domModalTitle.innerHTML = err.async ? "Unhandled Promise Rejection" : "Runtime Error";
      updateRuntimeErrorOverlay(err);
    } else {
      // Build errors
      domModalTitle.innerHTML = `<span class="count">${buildErrors.size}</span> Build Error${buildErrors.size === 1 ? "" : "s"}`;
    }

    domNavBar.active.textContent = (activeErrorIndex + 1 + (buildErrors.size > 0 ? 1 : 0)).toString();
    domNavBar.total.textContent = totalErrors.toString();
    domNavBar.label.textContent = totalErrors === 1 ? " Error" : " Errors";

    domNavBar.nextBtn.disabled = activeErrorIndex >= runtimeErrors.length - 1;
    domNavBar.prevBtn.disabled = buildErrors.size > 0 ? activeErrorIndex < 0 : activeErrorIndex == 0;
  }

  if (activeErrorIndex === -1) {
    if (lastActiveErrorIndex !== -1) {
      // clear the error content from the runtime error
      domErrorContent.innerHTML = "";
      updateBuildErrorOverlay({ remountAll: true });
    } else {
      updateBuildErrorOverlay({});
    }
  }

  lastActiveErrorIndex = activeErrorIndex;

  // The footer is only visible if there are build errors.
  if (buildErrors.size > 0) {
    domFooterText.style.display = "block";
    domFooterText.innerText =
      activeErrorIndex === -1
        ? "Errors during a build can only be dismissed by fixing them."
        : "This dialog cannot be dismissed as there are additional build errors.";
  } else {
    domFooterText.style.display = "none";
  }
  domNavBar.dismissAllBtn.style.display = buildErrors.size > 0 ? "none" : "block";
  // The navbar is only visible if there are runtime errors. It contains the dismiss button.
  domNavBar.root.style.display = runtimeErrors.length > 0 ? "flex" : "none";

  setModalVisible(true);
}

/**
 * Called when switching between runtime errors.
 */
function updateRuntimeErrorOverlay(err: RuntimeError) {
  domErrorContent.innerHTML = ""; // clear contents
  const dom = elem("div", { class: "r-error" });
  let name = err.name;
  if (!name || name === "Error") name = "error";
  dom.appendChild(
    elem("div", { class: "message-desc error" }, [
      elemText("code", { class: "name" }, name),
      elemText("code", { class: "muted" }, ": "),
      elemText("code", {}, err.message),
    ]),
  );
  const { code } = err;
  let trace = err.trace;
  if (code) {
    const {
      lines,
      col: columnToHighlight,
      loi: lineOfInterestOffset,
      len: highlightLength,
      firstLine: firstLineNumber,
    } = code;
    const codeFrame = trace[0];
    trace = trace.slice(1);

    const domCode = elem("div", { class: "r-code-wrap" });

    const aboveRoi = lines.slice(0, lineOfInterestOffset + 1);
    const belowRoi = lines.slice(lineOfInterestOffset + 1);

    const gutter = elem("div", { class: "gutter" }, [
      elemText("div", null, aboveRoi.map((_, i) => `${i + firstLineNumber}`).join("\n")),
      elem("div", { class: "highlight-gap" }),
      elemText("div", null, belowRoi.map((_, i) => `${i + firstLineNumber + aboveRoi.length}`).join("\n")),
    ]);
    domCode.appendChild(
      elem("div", { class: "code" }, [
        gutter,
        elem("div", { class: "view" }, [
          ...aboveRoi.map(line => mapCodePreviewLine(line)),
          elem("div", { class: "highlight-wrap log-error" }, [
            elemText("span", { class: "space" }, "_".repeat(columnToHighlight - 1)),
            elemText("span", { class: "line" }, "_".repeat(highlightLength)),
          ]),
          ...belowRoi.map(line => mapCodePreviewLine(line)),
        ]),
      ]),
    );
    domCode.appendChild(renderTraceFrame(codeFrame, "trace-frame"));

    dom.appendChild(domCode);
  }

  dom.appendChild(
    elem(
      "div",
      { class: "r-error-trace" },
      trace.map(frame => renderTraceFrame(frame, "trace-frame")),
    ),
  );
  domErrorContent.appendChild(dom);
}

function updateBuildErrorOverlay({ remountAll = false }) {
  let totalCount = 0;

  const owners = remountAll ? buildErrors.keys() : updatedErrorOwners;

  for (const owner of owners) {
    const data = buildErrors.get(owner);
    let dom = errorDoms.get(owner);

    // If this failure was removed, delete it.
    if (!data) {
      dom?.root.remove();
      errorDoms.delete(owner);
      continue;
    }

    totalCount += data.messages.length;

    // Create the element for the root if it does not yet exist.
    if (!dom || remountAll) {
      let fileName;
      const root = elem("div", { class: "b-group" }, [
        elem("div", { class: "trace-frame" }, [elem("div", { class: "file-name" }, [(fileName = textNode())])]),
      ]);
      dom = { root, fileName, messages: [] };
      domErrorContent.appendChild(root);
      errorDoms.set(owner, dom);
    } else {
      // For simplicity, messages are not reused, even if left unchanged.
      dom.messages.forEach(msg => msg.remove());
    }

    // Update the DOM with the new data.
    dom.fileName.textContent = data.file;

    for (const msg of data.messages) {
      const domMessage = renderBundlerMessage(msg);
      dom.root.appendChild(domMessage);
      dom.messages.push(domMessage);
    }
  }
  updatedErrorOwners.clear();
}

function mapCodePreviewLine(line: string) {
  const pre = elem("pre");
  pre.innerHTML = line;
  return pre;
}

const bundleLogLevelToName = ["error", "warn", "note", "debug", "verbose"];

function renderBundlerMessage(msg: BundlerMessage) {
  return elem(
    "div",
    { class: "b-msg" },
    [
      renderErrorMessageLine(msg.level, msg.message),
      ...(msg.location ? renderCodeLine(msg.location, msg.level) : []),
      ...msg.notes.map(renderNote),
    ].flat(1),
  );
}

function renderTraceFrame(frame: Frame, className: string) {
  const hasFn = !!frame.fn;
  return elem("div", { class: className }, [
    elemText("span", { class: "muted" }, "at "),
    ...(hasFn
      ? [
          //
          elemText("span", { class: "function-name" }, frame.fn),
          elemText("span", { class: "muted" }, " in "),
        ]
      : []),
    elemText("span", { class: "file-name" }, frame.file!),
    ...(frame.line
      ? [elemText("code", { class: "muted" }, `:${frame.line}` + (frame.col ? `:${frame.col}` : ""))]
      : []),
  ]);
}

function renderErrorMessageLine(level: BundlerMessageLevel, text: string) {
  const levelName = bundleLogLevelToName[level];
  if (IS_BUN_DEVELOPMENT && !levelName) {
    throw new Error("Unknown log level: " + level);
  }
  return elem("div", { class: "message-desc " + levelName }, [
    elemText("span", { class: "log-label log-" + levelName }, levelName),
    elemText("span", { class: "log-colon" }, ": "),
    elemText("span", { class: "log-text" }, text),
  ]);
}

function renderCodeLine(location: BundlerMessageLocation, level: BundlerMessageLevel) {
  return [
    elem("div", { class: "code" }, [
      elem("div", { class: "gutter" }, [elemText("div", null, `${location.line}`)]),
      elem("div", { class: "view" }, [
        mapCodePreviewLine(syntaxHighlight(location.lineText)),
        elem("div", { class: "highlight-wrap log-" + bundleLogLevelToName[level] }, [
          elemText("span", { class: "space" }, "_".repeat(location.column - 1)),
          elemText("span", { class: "line" }, "_".repeat(location.length)),
        ]),
      ]),
    ]),
  ];
}

function renderNote(note: BundlerNote) {
  return [
    renderErrorMessageLine(BundlerMessageLevel.note, note.message),
    ...(note.location ? renderCodeLine(note.location, BundlerMessageLevel.note) : []),
  ];
}

function onDismissAllErrors() {
  if (buildErrors.size === 0) {
    setModalVisible(false);
  } else {
    // Cannot dismiss build errors?
    activeErrorIndex = -1;
    updateErrorOverlay();
  }
}

function onPrevError() {
  if (activeErrorIndex === -1) return;
  if (activeErrorIndex === 0 && buildErrors.size === 0) return;
  activeErrorIndex--;
  needUpdateNavbar = true;
  updateErrorOverlay();
}

function onNextError() {
  if (activeErrorIndex >= runtimeErrors.length - 1) return;
  activeErrorIndex++;
  needUpdateNavbar = true;
  updateErrorOverlay();
}

declare global {
  interface HTMLElementTagNameMap {
    "bun-hmr": HTMLElement;
  }
}

import { BundlerMessageLevel } from "../enums";
import { DataViewReader, DataViewWriter } from "./data-view";
import {
  BundlerMessage,
  BundlerMessageLocation,
  BundlerNote,
  decodeSerializedError,
  type DeserializedFailure,
} from "./error-serialization";
import { syntaxHighlight } from "./JavaScriptSyntaxHighlighter";
import { parseStackTrace, type Frame } from "./stack-trace";
