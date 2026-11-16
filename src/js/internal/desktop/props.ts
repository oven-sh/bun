// From the props of JSX to the DOM, the way React DOM does it.
const core = require("internal/desktop/dom/core");

const { HTML, MATHML, SVG, removeAttr, setAttr, splitTokens, wrap } = core;

type N = $Dom.N;
type Props = Record<string, any>;

class Handler {
  callback: Function;

  constructor(callback: Function) {
    this.callback = callback;
  }
  handleEvent(event: object) {
    const { callback } = this;
    callback(event);
  }
}
type Handlers = Map<string, Handler>;

const ignored = new Set(
  splitTokens("children ref key value checked defaultValue defaultChecked suppressContentEditableWarning autoFocus"),
);
const renamed = new Map([
  ["className", "class"],
  ["htmlFor", "for"],
  ["httpEquiv", "http-equiv"],
  ["acceptCharset", "accept-charset"],
  ["xlinkHref", "href"],
]);
const withBooleanText = /^(?:aria-|data-|contentEditable$|draggable$|spellCheck$|focusable$)/;
const hyphenatedInSvg =
  /^(?:alignmentB|baselineS|clip[PR]|color[IR]|dominantB|fill|flood|font|imageR|letterS|lightingC|marker[EMS]|paintO|pointerE|shapeR|stop|stroke|text[ADR]|transformO|vectorE|wordS|writingM)(?!athU)/;
const lowercaseInSvg = new Set(["tabIndex", "crossOrigin"]);
const unitless = new Set(
  splitTokens(`animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth columnCount columns
  fillOpacity flex flexGrow flexShrink floodOpacity fontWeight gridArea gridColumn gridColumnEnd gridColumnStart gridRow
  gridRowEnd gridRowStart lineClamp lineHeight opacity order orphans scale stopOpacity strokeDasharray strokeDashoffset
  strokeMiterlimit strokeOpacity strokeWidth tabSize WebkitLineClamp widows zIndex zoom`),
);
const eventNames = new Map([
  ["doubleclick", "dblclick"],
  ["focus", "focusin"],
  ["blur", "focusout"],
  ["change", "input"],
]);

function setHandler(node: N, handlers: Handlers, name: string, callback: unknown) {
  const known = handlers.$get(name);
  if (known !== undefined && callback) return void (known.callback = callback as Function);
  const isCapture = name.endsWith("Capture") && !name.endsWith("PointerCapture");
  const lower = name.slice(2, isCapture ? -7 : undefined).toLowerCase();
  const type = eventNames.$get(lower) ?? lower;
  if (known !== undefined) {
    handlers.$delete(name);
    wrap(node).removeEventListener(type, known, isCapture);
  } else if (callback) {
    const handler = new Handler(callback as Function);
    handlers.$set(name, handler);
    wrap(node).addEventListener(type, handler, isCapture);
  }
}

function setStyle(node: N, value: any, old: any) {
  if (!$isObject(value)) return void (value ? setAttr(node, "style", value) : removeAttr(node, "style"));
  const { style } = wrap(node);
  if (!$isObject(old)) {
    if (old) removeAttr(node, "style");
    old = {};
  }
  const set = (name: string, text: string) => {
    if (name.startsWith("--")) style.setProperty(name, text);
    else style[name] = text;
  };
  for (const name in old) if (!(name in value)) set(name, "");
  for (const name in value) {
    const it = value[name];
    if (it === old[name]) continue;
    const needsUnit = typeof it === "number" && it !== 0 && !unitless.$has(name) && !name.startsWith("--");
    set(name, it == null || typeof it === "boolean" ? "" : needsUnit ? it + "px" : String(it));
  }
}

function attributeName(node: N, name: string): string {
  const known = renamed.$get(name);
  if (known !== undefined) return known;
  if (node.ns === HTML || lowercaseInSvg.$has(name)) return name.toLowerCase();
  return hyphenatedInSvg.test(name) ? name.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()) : name;
}

function setProp(node: N, handlers: Handlers, name: string, value: any, old: any) {
  if (ignored.$has(name) && (node.x?.reset !== undefined || (name !== "value" && name !== "checked"))) return;
  if (/^on[A-Z]/.test(name)) setHandler(node, handlers, name, value);
  else if (name === "style") setStyle(node, value, old);
  else if (name === "dangerouslySetInnerHTML") {
    if (value?.__html !== old?.__html) wrap(node).innerHTML = value?.__html ?? "";
  } else if (node.flags & core.flags.CUSTOM && name in node.js) node.js[name] = value;
  else if (name === "muted" || name === "selected" || name === "indeterminate") wrap(node)[name] = !!value;
  else if (typeof value === "boolean" && withBooleanText.test(name))
    setAttr(node, attributeName(node, name), "" + value);
  else if (value == null || value === false) removeAttr(node, attributeName(node, name));
  else setAttr(node, attributeName(node, name), value === true ? "" : String(value));
}

function setProps(node: N, handlers: Handlers, props: Props, old: Props) {
  for (const name in old) if (!(name in props)) setProp(node, handlers, name, undefined, old[name]);
  for (const name in props) if (props[name] !== old[name]) setProp(node, handlers, name, props[name], old[name]);
  core.react();
}

/** After the children, because a `select` needs its options. Also after the user changed what a prop controls. */
function setValue(node: N, props: Props, isNew: boolean) {
  if (node.x?.reset === undefined) return;
  const value = props.value ?? (isNew ? props.defaultValue : undefined);
  const checked = props.checked ?? (isNew ? props.defaultChecked : undefined);
  if (value == null && checked == null) return;
  const element = wrap(node);
  if (checked != null) element[props.checked == null ? "defaultChecked" : "checked"] = !!checked;
  if (value == null) return;
  if (node.name === "select") {
    if (!$isArray(value)) element.value = value;
    else for (const option of element.options) option.selected = value.some(it => String(it) === option.value);
  } else if (props.value == null) element.defaultValue = value;
  else if (element.value !== String(value) && !(props.type === "number" && +element.value === +value)) {
    element.value = value;
  }
}

function createElement(type: string, parent: N): N {
  let ns = parent.ns === HTML || parent.name === "foreignObject" ? HTML : parent.ns;
  if (type === "svg") ns = SVG;
  else if (type === "math") ns = MATHML;
  return core.createElement(parent.doc, type, ns, null, true);
}

/** `owned` tells the children that were rendered from those that something else put there. */
function replaceChildren(parent: N, nodes: N[], owned: (node: N) => boolean) {
  const wanted = new Set(nodes);
  for (let child = parent.first, next: N | null; child !== null; child = next) {
    next = child.next;
    if (!wanted.$has(child) && owned(child)) core.remove(child);
  }
  let at = parent.first;
  for (const node of nodes) {
    while (at !== null && !wanted.$has(at)) at = at.next;
    if (at === node) at = at.next;
    else core.insert(node, parent, at);
    wanted.$delete(node);
  }
  core.react();
}

export default { createElement, replaceChildren, setProps, setValue };
