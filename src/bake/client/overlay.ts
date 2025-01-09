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
import { BundlerMessageLevel } from "../enums";
import { css } from "../macros" with { type: "macro" };
import {
  BundlerMessage,
  BundlerMessageLocation,
  BundlerNote,
  decodeSerializedError,
  type DeserializedFailure,
} from "./error-serialization";
import { DataViewReader } from "./reader";

if (side !== "client") throw new Error("Not client side!");

export let hasFatalError = false;

// I would have used JSX, but TypeScript types interfere in odd ways.
function elem(tagName: string, props?: null | Record<string, string>, children?: (HTMLElement | Text)[]) {
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

/**
 * 32-bit integer corresponding to `SerializedFailure.Owner.Packed`
 * It is never decoded client-side; treat this as an opaque identifier.
 */
type ErrorId = number;

const errors = new Map<ErrorId, DeserializedFailure>();
const errorDoms = new Map<ErrorId, ErrorDomNodes>();
const updatedErrorOwners = new Set<ErrorId>();

let domShadowRoot: HTMLElement;
let domModalTitle: Text;
let domErrorList: HTMLElement;

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
      "position:absolute!important;" +
      "display:none!important;" +
      "top:0!important;" +
      "left:0!important;" +
      "width:100%!important;" +
      "height:100%!important;" +
      "background:#8883!important",
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
export function onErrorMessage(view: DataView) {
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

export function onRuntimeError(err: any, type: RuntimeErrorType) {
  if (type === RuntimeErrorType.fatal) {
    hasFatalError = true;
  }
 
  console.error(err);
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
  console.log(errors, updatedErrorOwners);

  if (errors.size === 0) {
    setModalVisible(false);
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
        (btn = elem("button", { class: "file-name" }, [(title = textNode())])),
      ]);
      btn.addEventListener("click", () => {
        const firstLocation = errors.get(owner)?.messages[0]?.location;
        if (!firstLocation) return;
        let fileName = title.textContent.replace(/^\//, "");
        fetch("/_bun/src/" + fileName, {
          headers: {
            "Open-In-Editor": "1",
            "Editor-Line": firstLocation.line.toString(),
            "Editor-Column": firstLocation.column.toString(),
          },
        });
      });
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
      const domMessage = renderBundlerMessage(msg);
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

function renderErrorMessageLine(level: BundlerMessageLevel, text: string) {
  const levelName = bundleLogLevelToName[level];
  if (IS_BUN_DEVELOPMENT && !levelName) {
    throw new Error("Unknown log level: " + level);
  }
  return elem("div", { class: "message-text" }, [
    elemText("span", { class: "log-" + levelName }, levelName),
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
