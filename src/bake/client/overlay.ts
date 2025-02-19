// This file implements the UI for error modals. Since using a framework like
// React could collide with the user's code (consider React DevTools), this
// entire modal is written from scratch using the standard DOM APIs. All CSS is
// scoped in `overlay.css`, and all elements exist under a shadow root. These
// constraints make the overlay simple to understand and work on.
//
// This file has two consumers:
// - The bundler error page which embeds a list of bundler errors to render.
// - The client runtime, for when reloading errors happen.
// Both use a WebSocket to coordinate followup updates, when new errors are
// added or previous ones are solved.
if (side !== "client") throw new Error("Not client side!");

/** When set, the next successful build will reload the page. */
export let hasFatalError = false;

/**
 * 32-bit integer corresponding to `SerializedFailure.Owner.Packed`
 * It is never decoded client-side, but the client is able to encode
 * values from 0 to 2^30-1, as that corresponds to
 * .{ .kind = .none, .data = ... }, which is unused in DevServer.
 */
type ErrorId = number;

const errors = new Map<ErrorId, DeserializedFailure>();
const runtimeErrors: RuntimeMessage[] = [];
const errorDoms = new Map<ErrorId, ErrorDomNodes>();
const updatedErrorOwners = new Set<ErrorId>();

let domShadowRoot: HTMLElement;
let domModalTitle: Text;
let domErrorList: HTMLElement;

// I would have used JSX, but TypeScript types interfere in odd ways.
function elem(tagName: string, props?: null | Record<string, string>, children?: Node[]) {
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

function elemText(tagName: string, props: null | Record<string, string>, innerHTML: string) {
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
  title: Text;
  messages: HTMLElement[];
}

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
      "background:#8883!important" +
      "z-index:2147483647!important",
  });
  const shadow = domShadowRoot.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replace(css("client/overlay.css", IS_BUN_DEVELOPMENT));
  shadow.adoptedStyleSheets = [sheet];

  const root = elem("div", { class: "root" }, [
    elem("div", { class: "modal" }, [
      elem("header", null, [(domModalTitle = textNode())]),
      (domErrorList = elem("div", { class: "error-list" })),
      elem("footer", null, [
        // TODO: for HMR turn this into a clickable thing + say it can be dismissed
        textNode("Errors during a build can only be dismissed fixing them."),
      ]),
    ]),
  ]);
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
export function onErrorMessage(view: DataView<ArrayBuffer>) {
  const reader = new DataViewReader(view, 1);
  const removedCount = reader.u32();

  for (let i = 0; i < removedCount; i++) {
    const removed = reader.u32();
    updatedErrorOwners.add(removed);
    errors.delete(removed);
  }

  while (reader.hasMoreData()) {
    decodeAndAppendError(reader);
  }

  updateErrorOverlay();
}

export const enum RuntimeErrorType {
  recoverable,
  /** Requires that clearances perform a full page reload */
  fatal,
}

let nextRuntimeErrorId = 0;
function newRuntimeErrorId() {
  if (nextRuntimeErrorId >= 0xfffffff) nextRuntimeErrorId = 0;
  return nextRuntimeErrorId++;
}

export async function onRuntimeError(err: any, type: RuntimeErrorType) {
  if (type === RuntimeErrorType.fatal) {
    hasFatalError = true;
  }

  console.error(err); // Chrome DevTools and Safari inspector will source-map this error

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
  const base = location.origin + "/_bun";
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
      writer.stringWithLength(fileName.startsWith(base) ? fileName.slice(base.length - "/_bun".length) : fileName);
    } else {
      writer.u32(0);
    }
  }

  // Request the error to be reported and remapped.
  const response = await fetch("/_bun/report_error", {
    method: "POST",
    body: writer.view.buffer,
  });
  let remapped: RuntimeMessage;
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
    remapped = {
      kind: "rt",
      name,
      message,
      trace,
      remapped: true,
    };
  } catch (e) {
    console.error("Failed to remap error", e);
    remapped = {
      kind: "rt",
      name,
      message,
      trace: parsed,
      remapped: false,
    };
  }

  const uid = newRuntimeErrorId();
  errors.set(uid, {
    file: remapped.trace.find(f => f.file)?.file ?? "[unknown file]",
    messages: [remapped],
  });
  updatedErrorOwners.add(uid);
  updateErrorOverlay();
}

/**
 * Call this for each error, then call `updateErrorOverlay` to commit the
 * changes to the UI in one smooth motion.
 */
export function decodeAndAppendError(r: DataViewReader) {
  const owner = r.u32();
  const file = r.string32() || null;
  const messageCount = r.u32();
  const messages = new Array(messageCount);
  for (let i = 0; i < messageCount; i++) {
    messages[i] = decodeSerializedError(r);
  }
  errors.set(owner, { file, messages });
  updatedErrorOwners.add(owner);
}

export function updateErrorOverlay() {
  if (errors.size === 0) {
    if (IS_ERROR_RUNTIME) {
      location.reload();
    } else {
      setModalVisible(false);
    }
    return;
  }

  mountModal();

  let totalCount = 0;

  for (const owner of updatedErrorOwners) {
    const data = errors.get(owner);
    let dom = errorDoms.get(owner);

    // If this failure was removed, delete it.
    if (!data) {
      dom?.root.remove();
      errorDoms.delete(owner);
      continue;
    }

    totalCount += data.messages.length;

    // Create the element for the root if it does not yet exist.
    if (!dom) {
      let title;
      let btn;
      const root = elem("div", { class: "message-group" }, [
        // (btn = elem("button", { class: "file-name" }, [(title = textNode())])),
        elem("div", { class: "file-name" }, [(title = textNode())]),
      ]);
      // btn.addEventListener("click", () => {
      //   const firstLocation = errors.get(owner)?.messages[0]?.location;
      //   if (!firstLocation) return;
      //   let fileName = title.textContent.replace(/^\//, "");
      //   fetch("/_bun/src/" + fileName, {
      //     headers: {
      //       "Open-In-Editor": "1",
      //       "Editor-Line": firstLocation.line.toString(),
      //       "Editor-Column": firstLocation.column.toString(),
      //     },
      //   });
      // });
      dom = { root, title, messages: [] };
      // TODO: sorted insert?
      domErrorList.appendChild(root);
      errorDoms.set(owner, dom);
    } else {
      // For simplicity, messages are not reused, even if left unchanged.
      dom.messages.forEach(msg => msg.remove());
    }

    // Update the DOM with the new data.
    dom.title.textContent = data.file;

    for (const msg of data.messages) {
      const domMessage = msg.kind === "bundler" ? renderBundlerMessage(msg) : renderRuntimeMessage(msg);
      dom.root.appendChild(domMessage);
      dom.messages.push(domMessage);
    }
  }

  domModalTitle.textContent = `${errors.size} Build Error${errors.size !== 1 ? "s" : ""}`;

  updatedErrorOwners.clear();

  setModalVisible(true);
}

const bundleLogLevelToName = ["error", "warn", "note", "debug", "verbose"];

function renderBundlerMessage(msg: BundlerMessage) {
  return elem(
    "div",
    { class: "message" },
    [
      renderErrorMessageLine(msg.level, msg.message),
      ...(msg.location ? renderCodeLine(msg.location, msg.level) : []),
      ...msg.notes.map(renderNote),
    ].flat(1),
  );
}

function renderRuntimeMessage(msg: RuntimeMessage) {
  let name = msg.name;
  if (name === "Error") msg.name = "error";
  return elem(
    "div",
    { class: "message" },
    [
      elem("div", { class: "message-text" }, [
        elemText("span", { class: "log-label log-error" }, msg.name),
        elemText("span", { class: "log-colon" }, ": "),
        elemText("span", { class: "log-text" }, msg.message),
      ]),
      ...msg.trace.map(renderTraceFrame),
    ].flat(1),
  );
}

function renderTraceFrame(frame: Frame) {
  const elems: Node[] = [elemText("span", { class: "trace-at" }, "at ")];
  let hasFn = !!frame.fn;
  if (hasFn) {
    elems.push(elemText("span", { class: "trace-fn" }, frame.fn), elemText("span", { class: "trace-sep" }, " "));
  }
  if (frame.file) {
    if (hasFn) elems.push(elemText("span", { class: "trace-sep" }, "("));
    elems.push(elemText("span", { class: "trace-file" }, frame.file));
    if (frame.line) {
      elems.push(textNode(":"), elemText("span", { class: "trace-loc" }, frame.line.toString()));
      if (frame.col) {
        elems.push(textNode(":"), elemText("span", { class: "trace-loc" }, frame.col.toString()));
      }
    }
    if (hasFn) elems.push(textNode(")"));
  }
  return elem("div", { class: "trace-frame" }, elems);
}

function renderErrorMessageLine(level: BundlerMessageLevel, text: string) {
  const levelName = bundleLogLevelToName[level];
  if (IS_BUN_DEVELOPMENT && !levelName) {
    throw new Error("Unknown log level: " + level);
  }
  return elem("div", { class: "message-text" }, [
    elemText("span", { class: "log-label log-" + levelName }, levelName),
    elemText("span", { class: "log-colon" }, ": "),
    elemText("span", { class: "log-text" }, text),
  ]);
}

function renderCodeLine(location: BundlerMessageLocation, level: BundlerMessageLevel) {
  return [
    elem("div", { class: "code-line" }, [
      elemText("code", { class: "line-num" }, `${location.line}`),
      elemText("pre", { class: "code-view" }, location.lineText),
    ]),
    elem("div", { class: "highlight-wrap log-" + bundleLogLevelToName[level] }, [
      elemText("span", { class: "space" }, "_".repeat(`${location.line}`.length + location.column - 1)),
      elemText("span", { class: "line" }, "_".repeat(location.length)),
    ]),
  ];
}

function renderNote(note: BundlerNote) {
  return [
    renderErrorMessageLine(BundlerMessageLevel.note, note.message),
    ...(note.location ? renderCodeLine(note.location, BundlerMessageLevel.note) : []),
  ];
}

import { BundlerMessageLevel } from "../enums";
import { css } from "../macros" with { type: "macro" };
import {
  BundlerMessage,
  BundlerMessageLocation,
  BundlerNote,
  decodeSerializedError,
  type DeserializedFailure,
  Frame,
  RuntimeMessage,
} from "./error-serialization";
import { DataViewReader, DataViewWriter } from "./reader";
import { parseStackTrace } from "./stack-trace";
