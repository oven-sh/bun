globalThis.owners = new Map();
const origin = frame => {
  const rect = frame.getBoundingClientRect(),
    style = getComputedStyle(frame),
    scale = rect.width / frame.offsetWidth || 1;
  const inset = side => (frame["client" + side] + parseFloat(style["padding" + side])) * scale;
  return [rect.left + inset("Left"), rect.top + inset("Top"), scale];
};
const place = element => {
  let [x, y, scale] = [0, 0, 1];
  for (
    let at = element;
    at;
    at = at.ownerDocument.defaultView === window ? null : at.ownerDocument.defaultView?.frameElement
  ) {
    const [left, top, own] = origin(at);
    [x, y, scale] = [left + x * own, top + y * own, scale * own];
  }
  return [x, y, scale];
};
const around = element =>
  element.ownerDocument.defaultView === window ? [0, 0, 1] : place(element.ownerDocument.defaultView.frameElement);
const deepest = step => {
  for (let at = step(document); at;) {
    const inner = at.shadowRoot ?? at.contentDocument,
      next = inner && step(inner);
    if (!next || next === at) return at;
    at = next;
  }
};
globalThis.hit = (x, y) => {
  const isOnTop = it => {
    const root = it.getRootNode(),
      [left, top, scale] = around(it);
    if (root.elementFromPoint((x - left) / scale, (y - top) / scale) !== it) return false;
    const { ownerDocument } = it;
    return ownerDocument === document || isOnTop(ownerDocument.defaultView.frameElement);
  };
  for (const [id, owner] of owners) if (owner.isConnected && isOnTop(owner)) return [id, ...place(owner)];
};
globalThis.focusOwner = id => {
  const owner = owners.get(id);
  if (owner && owner.getRootNode().activeElement !== owner) owner.focus({ preventScroll: true });
};
// The list of a <select> would be a menu or a window of the engine.
let wanted, listed;
const opensList = ({ type, button, key, altKey }) =>
  type === "mousedown"
    ? button === 0
    : key === " " ||
      (isMac
        ? /^Arrow(?:Up|Down)$/.test(key)
        : /^(?:Enter|F4)$/.test(key) || (altKey && /^Arrow(?:Up|Down)$/.test(key)));
const watch = event => {
  const path = event.composedPath(),
    [it] = path;
  if (!it.matches?.("select:enabled:not([multiple])") || it.size > 1 || !opensList(event)) return;
  if (getComputedStyle(it, "::picker(select)").appearance === "base-select") return;
  const decided = new AbortController();
  const afterThePage = () => {
    if (!event.cancelBubble && event.currentTarget !== path.at(-1)) return;
    decided.abort();
    if (event.defaultPrevented) return;
    event.preventDefault();
    it.focus();
    wanted = it;
  };
  for (const node of path) node.addEventListener(event.type, afterThePage, { once: true, signal: decided.signal });
};
const watchLists = it => {
  for (const type of ["mousedown", "keydown"]) it?.ownerDocument.defaultView.addEventListener(type, watch, true);
};
const describeList = it =>
  [...it.querySelectorAll("option,optgroup,hr")]
    .filter(row => getComputedStyle(row).display !== "none")
    .map(row => [row.localName, row.label, row.index, row.selected, row.matches(":disabled"), !!row.parentNode.label]);
globalThis.choose = index => {
  if (listed.selectedIndex === index) return;
  listed.selectedIndex = index;
  listed.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  listed.dispatchEvent(new Event("change", { bubbles: true }));
};
globalThis.focused = () => {
  const it = deepest(root => root.activeElement);
  for (const [id, owner] of owners)
    if (owner.getRootNode().activeElement === owner && (it === owner || it.contains(owner.getRootNode().host)))
      return { frame: [id, ...place(owner)] };
  if (!it) return {};
  watchLists(it);
  const list = wanted === it ? describeList((listed = it)) : undefined;
  wanted = undefined;
  const range =
    it.isContentEditable &&
    it.getRootNode().getSelection?.().rangeCount &&
    it.getRootNode().getSelection().getRangeAt(0);
  const rect = (range && range.getClientRects()[0]) || it.getBoundingClientRect(),
    [left, top, scale] = around(it);
  return {
    takesText: it.matches(":read-write:not([type=password i])"),
    isPassword: it.matches("[type=password i]:read-write"),
    hasPopup: it.matches("input:open"),
    list,
    caret: [left + rect.left * scale, top + rect.top * scale, rect.height * scale],
  };
};
globalThis.regions = () =>
  [...document.querySelectorAll("*")].flatMap(it => {
    const { appRegion, visibility } = getComputedStyle(it);
    if (appRegion === "none" || visibility !== "visible") return [];
    return Array.from(it.getClientRects(), ({ x, y, width, height }) => [x, y, width, height, appRegion === "drag"]);
  });
globalThis.selectBack = count => {
  const selection = deepest(root => root.activeElement)?.ownerDocument.getSelection();
  while (count-- > 0) selection?.modify("extend", "backward", "character");
};
globalThis.watchKey = () =>
  deepest(root => root.activeElement)?.ownerDocument.defaultView.addEventListener(
    "keydown",
    event => (globalThis.key = event),
    { capture: true, once: true },
    (globalThis.key = null),
  );
const elementAt = (x, y) =>
  deepest(root => {
    const [left, top, scale] = around(root.documentElement ?? root.host);
    return root.elementFromPoint((x - left) / scale, (y - top) / scale);
  });
globalThis.titleAt = (x, y) => elementAt(x, y)?.closest("[title]")?.title;
globalThis.watchListsAt = (x, y) => watchLists(elementAt(x, y));
globalThis.cursorAt = (x, y) => {
  const it = elementAt(x, y);
  if (!it) return;
  const cursor = getComputedStyle(it).cursor.split(",").at(-1).trim();
  if (cursor !== "auto") return cursor;
  if (it.matches(":read-write")) return "text";
  const [left, top, scale] = around(it),
    range = document.createRange();
  for (const child of it.childNodes) {
    range.selectNode(child);
    if (
      child.nodeType === 3 &&
      [...range.getClientRects()].some(
        r =>
          x >= left + r.left * scale &&
          x < left + r.right * scale &&
          y >= top + r.top * scale &&
          y < top + r.bottom * scale,
      )
    )
      return "text";
  }
  return "default";
};
