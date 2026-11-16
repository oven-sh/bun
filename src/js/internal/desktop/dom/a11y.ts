// The tree that assistive technologies see.
const livenessOfRoles = { alert: "assertive", log: "polite", status: "polite" };

const core = require("internal/desktop/dom/core");
const aria = require("internal/desktop/dom/aria");
const events = require("internal/desktop/dom/events");
const focusing = require("internal/desktop/dom/focus");
const forms = require("internal/desktop/dom/forms");
const html = require("internal/desktop/dom/html");
const editing = require("internal/desktop/dom/editing");
const { referenced } = require("internal/desktop/dom/node");

const { ELEMENT, getAttr, hasAttr, isHtml, splitTokens, states } = core;

type N = $Dom.N;
type Page = $Dom.Page;

const withoutChildren = new Set(
  splitTokens(`button checkbox img math menuitemcheckbox menuitemradio meter multilineTextbox option passwordbox
  progressbar radio scrollbar searchbox separator slider spinbutton switch tab textbox`),
);

/** As the library knows it. */
function roleOf(node: N): string {
  const role = aria.roleOf(node);
  if (role === "none") return "generic";
  if (role === "image" || role === "graphics-document") return "img";
  if (role !== "textbox") return role;
  if (isHtml(node, "input")) return node.x.type === "password" ? "passwordbox" : role;
  const isMultiline = isHtml(node, "textarea") || !hasAttr(node, "role") || getAttr(node, "aria-multiline") === "true";
  return isMultiline ? "multilineTextbox" : role;
}

function triState(node: N, name: string): boolean | string | undefined {
  const value = getAttr(node, name);
  return value === "mixed" ? value : value === "true" ? true : value === "false" ? false : undefined;
}

function numberOf(node: N, name: string, fallback?: number): number | undefined {
  const value = parseFloat(getAttr(node, name) ?? "");
  return value === value ? value : fallback;
}

function describe(node: N, role: string) {
  const isCheckable = isHtml(node, "input") && (role === "checkbox" || role === "radio");
  const hasRange = role === "slider" || role === "meter" || role === "progressbar" ? node.x : null;
  const text = forms.textControl(node);
  let value = getAttr(node, "aria-valuetext") ?? undefined;
  if (text !== null) value = role === "passwordbox" ? "•".repeat(text.text.length) : text.text;
  else if (isHtml(node, "select")) value = node.x.selected().map(forms.optionLabel).join(", ");
  else if (role === "textbox" || role === "multilineTextbox") value = core.wrap(node).innerText;
  let expanded = triState(node, "aria-expanded");
  if (core.hooks.isDetailsSummary(node)) expanded = hasAttr(node.parent!, "open");
  else {
    const nodeX = node.x;
    if (isHtml(node, "select") && nodeX.isDropDown()) expanded = nodeX.isOpen();
  }
  return {
    label: aria.nameOf(node) || undefined,
    value,
    description: aria.descriptionOf(node) || (getAttr(node, "aria-description") ?? undefined),
    placeholder: getAttr(node, "placeholder") ?? getAttr(node, "aria-placeholder") ?? undefined,
    checked: isCheckable ? (node.x.indeterminate ? "mixed" : node.x.checked) : triState(node, "aria-checked"),
    pressed: triState(node, "aria-pressed"),
    expanded,
    selected: isHtml(node, "option") ? node.x.selected : triState(node, "aria-selected"),
    disabled: forms.isDisabled(node) || getAttr(node, "aria-disabled") === "true",
    readonly: hasAttr(node, "readonly") || getAttr(node, "aria-readonly") === "true",
    required: hasAttr(node, "required") || getAttr(node, "aria-required") === "true",
    focusable: focusing.isFocusable(node),
    clickable: node.kind.activate !== null || aria.namedByContent.$has(role) || events.hasListeners(node, "click"),
    level: numberOf(node, "aria-level", role === "heading" ? +node.name[1] || 2 : undefined),
    min: numberOf(node, "aria-valuemin", hasRange?.min()),
    max: numberOf(node, "aria-valuemax", hasRange?.max()),
    now: numberOf(node, "aria-valuenow", hasRange ? +hasRange.value() : undefined),
    live: getAttr(node, "aria-live") ?? livenessOfRoles[role],
    url: role === "link" ? core.wrap(node).href : undefined,
    modal: (node.state & states.MODAL) !== 0 || getAttr(node, "aria-modal") === "true",
  };
}

function update(page: Page) {
  const { doc, zoom } = page;
  const all: object[] = [];
  let focus = 1;
  const boundsOf = (rect: number[]) => rect.slice(0, 4).map(it => it * zoom);
  const visit = (parent: N, into: number[]) => {
    for (const node of core.flatChildren(parent)) {
      if (node.id === 0) continue;
      if (node.type !== ELEMENT) {
        const label = splitTokens(node.data).join(" ");
        if (label === "" || (html.styleBits(node) & 3) !== 3) continue;
        const bounds = boundsOf(doc.engine.rangeRects(node.id, 0, node.id, node.data.length));
        if (bounds.length < 4) continue;
        all.push({ id: node.id, role: "text", label, bounds, children: [] });
        into.push(node.id);
        continue;
      }
      if (aria.isHidden(node) || focusing.isInert(node)) {
        if (core.containsFlat(node, core.hooks.topModal(doc))) visit(node, into);
        continue;
      }
      const role = roleOf(node);
      const isPlain = role === "generic" && !hasAttr(node, "aria-live") && !focusing.isFocusable(node);
      if (isPlain || !(html.styleBits(node) & (2 | 64))) {
        visit(node, into);
        continue;
      }
      const children: number[] = [];
      all.push({ id: node.id, role, bounds: boundsOf(html.boundingRect(node)), children, ...describe(node, role) });
      into.push(node.id);
      if (node === doc.focused) focus = node.id;
      if (!withoutChildren.$has(role)) visit(node, children);
    }
  };
  const children: number[] = [];
  const bounds = boundsOf([0, 0, page.width, page.height]);
  all.push({ id: 1, role: "document", label: core.wrap(doc.node).title, bounds, children });
  visit(doc.node, children);
  const active = doc.focused && referenced(doc.focused, "aria-activedescendant")?.[0];
  if (active && all.some((it: any) => it.id === active.id)) focus = active.id;
  page.native.send("surface.a11y", { id: page.surface, nodes: all, focus });
}

function pressKey(node: N, key: string) {
  focusing.focus(node, focusing.KEYBOARD);
  for (const e of ["down", "up"]) node.doc.page!.handleEvent({ t: "key", e, key, code: key, location: 0, m: 0 });
}

function perform(page: Page, { node: id, action, data }: any) {
  const node = page.doc.nodes[id];
  if (!node || node.type !== ELEMENT) return;
  switch (action) {
    case "click":
    case "expand":
    case "collapse":
      return isHtml(node, "select") ? node.x.setOpen(action !== "collapse") : html.click(node, true);
    case "focus":
      return focusing.focus(node, focusing.KEYBOARD);
    case "blur":
      return core.hooks.blur(node);
    case "setValue":
      focusing.focus(node, focusing.KEYBOARD);
      editing.execute(page.doc, "selectall", "", false);
      return void editing.insertText(page.doc, String(data), "insertReplacementText");
    case "increment":
    case "decrement":
      return pressKey(node, action === "increment" ? "ArrowUp" : "ArrowDown");
    case "scrollIntoView":
      return html.scrollIntoView(node, 3, 3);
    case "showContextMenu":
      return pressKey(node, "ContextMenu");
  }
}

export default { perform, update };
