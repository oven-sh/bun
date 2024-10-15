import { css } from "../macros" with { type: "macro" };
import { decodeSerializedError, type DeserializedFailure } from "./error-serialization";
import { DataViewReader } from "./reader";

// Would use JSX but TypeScript types interfere in odd ways.
function elem(tagName: string, props?: Record<string, string>, children?: HTMLElement[]) {
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

if (side !== "client") throw new Error("Not client side!");

/**
 * 32-bit integer corresponding to `SerializedFailure.Owner.Packed`
 * It is never decoded client-side; treat this as an opaque identifier.
 */
type ErrorId = number;

const errors = new Map<ErrorId, DeserializedFailure[]>();
const errorDoms = new Map<ErrorId, HTMLElement>();
const updatedErrorOwners = new Set<ErrorId>();

// Create a root element to contain all our our DOM nodes.
const wrap = elem("bun-hmr", {
  style:
    "position:absolute!important;" +
    "display:none!important;" +
    "top:0!important;" +
    "left:0!important;" +
    "width:100%!important;" +
    "height:100%!important;" +
    "background:#8883!important",
});
const shadow = wrap.attachShadow({ mode: "open" });

const sheet = new CSSStyleSheet();
sheet.replace(css("client/overlay.css", IS_BUN_DEVELOPMENT));
shadow.adoptedStyleSheets = [sheet];

const root = elem("main");
shadow.appendChild(root);
document.body.appendChild(wrap);

let isModalVisible = false;
function setModalVisible(visible: boolean) {
  if (isModalVisible === visible) return;
  isModalVisible = visible;
  wrap.style.display = visible ? "block" : "none";
}

/** Handler for `MessageId.errors` websocket packet */
export function onErrorMessage(view: DataView) {
  const reader = new DataViewReader(view, 1);
  const removedCount = reader.u32();

  for (let i = 0; i < removedCount; i++) {
    const removed = reader.u32();
    console.log(removedCount, removed)
    errors.delete(removed);
  }

  while (reader.hasMoreData()) {
    decodeAndAppendError(reader);
  }

  updateErrorOverlay();
}

/**
 * Call this for each error, then call `updateErrorOverlay` to commit the
 * changes to the UI in one smooth motion.
 */
export function decodeAndAppendError(r: DataViewReader) {
  const owner = r.u32();
  const messageCount = r.u32();
  const messages = new Array(messageCount);
  for (let i = 0; i < messageCount; i++) {
    messages[i] = decodeSerializedError(r);
  }
  errors.set(owner, messages);
  updatedErrorOwners.add(owner);
}

export function updateErrorOverlay() {
  console.log(errors, updatedErrorOwners);

  if (errors.size === 0) {
    setModalVisible(false);
    return;
  }

  setModalVisible(true);

  for (const owner of updatedErrorOwners) {
    const data = errors.get(owner);
    let dom = errorDoms.get(owner);

    if (!data && dom) {
      dom.remove();
      continue;
    }

    if (!dom) {
      dom = elem("div", {
        class: "error",
      });
      root.appendChild(dom);
      errorDoms.set(owner, dom);
    }

    dom.innerHTML = `<pre><code>${JSON.stringify(data, null, 2)}</code></pre>`;
  }

  updatedErrorOwners.clear();
}
