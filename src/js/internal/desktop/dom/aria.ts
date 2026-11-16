// https://w3c.github.io/html-aam/ and https://w3c.github.io/accname/
const core = require("internal/desktop/dom/core");
const focusing = require("internal/desktop/dom/focus");
const forms = require("internal/desktop/dom/forms");
const html = require("internal/desktop/dom/html");
const { referenced } = require("internal/desktop/dom/node");

const { ELEMENT, asciiLower, getAttr, hasAttr, isHtml, splitTokens } = core;

type N = $Dom.N;

const setOf = (names: string) => new Set<string>(splitTokens(names));
const mapOf = (entries: string) =>
  new Map<string, string>(splitTokens(entries).map(it => it.split(":") as [string, string]));

const roles =
  setOf(`alert alertdialog application article banner blockquote button caption cell checkbox code columnheader
  combobox comment complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic
  graphics-document graphics-object graphics-symbol grid gridcell group heading image img insertion link list listbox
  listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option
  paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox sectionfooter
  sectionheader separator slider spinbutton status strong subscript suggestion superscript switch tab table tablist tabpanel
  term textbox time timer toolbar tooltip tree treegrid treeitem`);
for (const name of splitTokens(`abstract acknowledgments afterword appendix backlink biblioentry bibliography biblioref
  chapter colophon conclusion cover credit credits dedication endnote endnotes epigraph epilogue errata example footnote
  foreword glossary glossref index introduction noteref notice pagebreak pagefooter pageheader pagelist part preface prologue
  pullquote qna subtitle tip toc`)) {
  roles.$add("doc-" + name);
}
const synonyms = mapOf("directory:list img:image presentation:none");
const implicit = mapOf(`address:group article:article blockquote:blockquote button:button caption:caption code:code
  datalist:listbox dd:definition del:deletion details:group dfn:term dialog:dialog dt:term em:emphasis fieldset:group
  figure:figure h1:heading h2:heading h3:heading h4:heading h5:heading h6:heading hgroup:group hr:separator iframe:document
  ins:insertion main:main mark:mark menu:list meter:meter nav:navigation ol:list optgroup:group option:option output:status
  p:paragraph progress:progressbar s:deletion search:search strong:strong sub:subscript sup:superscript table:table
  tbody:rowgroup textarea:textbox tfoot:rowgroup thead:rowgroup time:time tr:row ul:list`);
const ofInputs = mapOf(`button:button color:button file:button image:button reset:button submit:button checkbox:checkbox
  radio:radio range:slider number:spinbutton search:searchbox`);
const namedByContent =
  setOf(`button cell checkbox columnheader comment doc-backlink doc-biblioref doc-glossref doc-noteref
  gridcell heading link menuitem menuitemcheckbox menuitemradio option radio row rowheader switch tab term tooltip treeitem`);
const ranges = setOf("meter progressbar scrollbar slider spinbutton");
const sectioning = setOf("article aside nav section");
const sectioningRoles = setOf("article complementary navigation region");
const globalStates =
  setOf(`aria-atomic aria-braillelabel aria-brailleroledescription aria-busy aria-controls aria-current
  aria-describedby aria-description aria-details aria-dropeffect aria-flowto aria-grabbed aria-keyshortcuts aria-label
  aria-labelledby aria-live aria-owns aria-relevant aria-roledescription`);
/** The roles that mean nothing outside of these. */
const requiredContext = mapOf("listitem:list,group option:listbox,group,combobox treeitem:tree,group,treeitem");
const blank = /^[\t\n\f\r ]*$/;

const hasText = (text: string | null): text is string => text !== null && !blank.test(text);

function hasAuthorName(node: N): boolean {
  if (hasText(getAttr(node, "aria-label")) || hasText(getAttr(node, "title"))) return true;
  return !!referenced(node, "aria-labelledby")?.length;
}

function isInSection(node: N, orMain: boolean): boolean {
  for (let it = core.flatParent(node); it !== null && it.type === ELEMENT; it = core.flatParent(it)) {
    const role = explicitRole(it);
    if (role === undefined ? sectioning.$has(it.name) : sectioningRoles.$has(role)) return true;
    if (orMain && (role ?? it.name) === "main") return true;
  }
  return false;
}

function isInContext(node: N, wanted: string[]): boolean {
  for (let it = core.flatParent(node); it !== null && it.type === ELEMENT; it = core.flatParent(it)) {
    const role = roleOf(it);
    if (role !== "generic" && role !== "none") return wanted.includes(role);
  }
  return false;
}

function explicitRole(node: N): string | undefined {
  const given = getAttr(node, "role") ?? node.rare?.same?.$get("internals")?.role ?? null;
  for (const token of splitTokens(given === null ? null : asciiLower(given))) {
    if (!roles.$has(token)) continue;
    if ((token === "region" || token === "form") && hasAttr(node, "role") && !hasAuthorName(node)) continue;
    const role = synonyms.$get(token) ?? token;
    if (role !== "none") return role;
    const hasGlobalState = node.attrs!.some(
      (it, index) => index % 2 === 0 && globalStates.$has(it) && hasText(node.attrs![index + 1]),
    );
    return hasGlobalState || focusing.isFocusable(node) ? undefined : role;
  }
}

function headerRole(node: N): string {
  const scope = asciiLower(getAttr(node, "scope") ?? "");
  if (scope.startsWith("row")) return "rowheader";
  if (scope.startsWith("col") || isHtml(node.parent!.parent, "thead")) return "columnheader";
  return core.elementChildren(node.parent!).some(it => isHtml(it, "td")) ? "rowheader" : "columnheader";
}

function implicitRole(node: N): string {
  const { name } = node;
  if (node.ns === core.MATHML) return name === "math" ? "math" : "generic";
  if (node.ns === core.SVG) {
    if (name === "svg") return "graphics-document";
    if (name === "a" && core.svgHref(node) !== null) return "link";
    if (!hasAuthorName(node) && svgTitle(node) === null && !focusing.isFocusable(node)) return "none";
    return name === "image"
      ? "image"
      : name === "g" || name === "a"
        ? "group"
        : name === "use"
          ? "graphics-object"
          : "graphics-symbol";
  }
  switch (name) {
    case "a":
    case "area":
      return hasAttr(node, "href") ? "link" : "generic";
    case "aside":
      return !isInSection(node, false) || hasAuthorName(node) ? "complementary" : "generic";
    case "footer":
      return isInSection(node, true) ? "sectionfooter" : "contentinfo";
    case "header":
      return isInSection(node, true) ? "sectionheader" : "banner";
    case "form":
      return "form";
    case "section":
      return hasAuthorName(node) ? "region" : "generic";
    case "img":
      return getAttr(node, "alt") === "" && !hasAuthorName(node) ? "none" : "image";
    case "input": {
      const role = ofInputs.$get(node.x.type) ?? "textbox";
      if (role === "checkbox" && hasAttr(node, "switch")) return "switch";
      return (role === "textbox" || role === "searchbox") && core.wrap(node).list !== null ? "combobox" : role;
    }
    case "li": {
      const parent = core.parentElement(node);
      return parent !== null && explicitRole(parent) === "none" ? "none" : "listitem";
    }
    case "select":
      return node.x.isDropDown() ? "combobox" : "listbox";
    case "summary":
      return core.hooks.isDetailsSummary(node) ? "button" : "generic";
    case "td":
    case "th":
    case "tr":
    case "tbody":
    case "thead":
    case "tfoot": {
      const table = core.closestHtml(node, "table");
      const role = table === null ? "table" : roleOf(table);
      if (role !== "table" && role !== "grid" && role !== "treegrid") return role === "none" ? role : "generic";
      if (name === "th") return headerRole(node);
      if (name === "td") return role === "table" ? "cell" : "gridcell";
    }
  }
  return implicit.$get(name) ?? (core.hooks.isEditingHost(node) ? "textbox" : "generic");
}

function roleOf(node: N): string {
  const role = explicitRole(node);
  if (role === undefined) {
    const own = implicitRole(node);
    return own === "generic" && (hasAttr(node, "popover") || html.isDraggable(node) || hasAttr(node, "autofocus"))
      ? "group"
      : own;
  }
  const context = requiredContext.$get(role);
  const isOwned = () =>
    core.findDescendant(core.rootOf(node), it => !!referenced(it, "aria-owns")?.includes(node)) !== null;
  return context === undefined || isInContext(node, context.split(",")) || isOwned() ? role : implicitRole(node);
}

function isHidden(node: N): boolean {
  return asciiLower(getAttr(node, "aria-hidden") ?? "") === "true" || !(html.styleBits(node) & (1 | 64));
}

function isHiddenAbove(node: N): boolean {
  if (!(html.styleBits(node) & (2 | 64))) return true;
  for (let it: N | null = node; it !== null && it.type === ELEMENT; it = core.flatParent(it))
    if (isHidden(it)) return true;
  return false;
}

function svgTitle(node: N): string | null {
  const title = core.elementChildren(node).find(child => child.ns === core.SVG && child.name === "title");
  return title === undefined ? null : core.textContent(title);
}

type Walk = { root: N; seen: Set<N>; isReferenced: boolean; showsHidden: boolean };

function childrenOf(node: N): N[] {
  const owned = referenced(node, "aria-owns") ?? [];
  return [...core.flatChildren(node).filter(it => !owned.includes(it)), ...owned];
}

function generated(node: N, pseudo: string): string {
  return node.id === 0 ? "" : core.sync(node.doc).computedStyle(node.id, pseudo, "-internal-text");
}

function transformed(text: string, parent: N): string {
  const transform = parent.id === 0 ? "" : core.sync(parent.doc).computedStyle(parent.id, "", "text-transform");
  if (transform === "capitalize") return text.replace(/(?<![\p{L}\p{N}])\p{L}/gu, it => it.toUpperCase());
  return transform === "uppercase" ? text.toUpperCase() : transform === "lowercase" ? text.toLowerCase() : text;
}

function fromContent(node: N, walk: Walk): string {
  let text = generated(node, "::marker") + generated(node, "::before");
  for (const child of childrenOf(node)) {
    if (child.type !== ELEMENT) {
      if (!core.isText(child)) continue;
      if (walk.showsHidden || html.styleBits(node) & (2 | 64)) text += transformed(child.data, node);
    } else if (isHtml(child, "br")) text += "\n";
    else {
      const name = compute(child, walk);
      const display = child.id === 0 ? "inline" : core.sync(node.doc).computedStyle(child.id, "", "display");
      text += display === "inline" || display === "contents" || name === "" ? name : ` ${name} `;
    }
  }
  return text + generated(node, "::after");
}

function fromAll(list: N[], walk: Walk, isReferenced: boolean): string {
  const each = (node: N) => {
    if (isReferenced) walk.seen.$delete(node);
    return compute(
      node,
      {
        ...walk,
        isReferenced: isReferenced || walk.isReferenced,
        showsHidden: walk.showsHidden || isHiddenAbove(node),
      },
      true,
    );
  };
  return list.map(each).join(" ");
}

function embeddedValue(node: N, role: string, walk: Walk): string | undefined {
  const text = forms.textControl(node);
  if (ranges.$has(role))
    return getAttr(node, "aria-valuetext") ?? getAttr(node, "aria-valuenow") ?? `${core.wrap(node).value ?? ""}`;
  if (text !== null) return text.text;
  if (isHtml(node, "select")) return node.x.selected().map(forms.optionLabel).join(" ");
  if (role === "textbox" || role === "searchbox") return fromContent(node, walk);
  if (role !== "combobox" && role !== "listbox") return;
  const selected = core.filterDescendants(
    node,
    it => getAttr(it, "aria-selected") === "true" && roleOf(it) === "option",
  );
  return selected.length > 0 || role === "listbox" ? fromAll(selected, walk, false) : fromContent(node, walk);
}

function nativeName(node: N, walk: Walk): string | null {
  if (node.ns === core.SVG) return svgTitle(node) ?? core.getAttrNS(node, core.XLINK_NS, "title");
  if (node.ns !== core.HTML) return null;
  if (core.wrap(node).labels || node.rare?.definition?.formAssociated) {
    const label = fromAll(forms.labelsOf(node), walk, false);
    if (hasText(label)) return label;
  }
  const caption = { __proto__: null, fieldset: "legend", table: "caption" }[node.name];
  if (caption) return fromAll(html.childrenNamed(node, caption).slice(0, 1), walk, false);
  if (node.name === "img" || node.name === "area") return getAttr(node, "alt");
  if (node.name === "optgroup" || node.name === "option") return getAttr(node, "label");
  if (node.name !== "input") return null;
  const { type } = node.x;
  if (type === "image") return getAttr(node, "alt") ?? getAttr(node, "value") ?? getAttr(node, "title") ?? "Submit";
  if (type === "button") return getAttr(node, "value");
  return type === "submit" || type === "reset"
    ? (getAttr(node, "value") ?? (type === "submit" ? "Submit" : "Reset"))
    : null;
}

function compute(node: N, walk: Walk, isLabel = false): string {
  if (walk.seen.$has(node)) return "";
  walk.seen.$add(node);
  const isRoot = node === walk.root && !isLabel;
  if (!walk.showsHidden) {
    if (isHidden(node)) return "";
    if (!(html.styleBits(node) & (2 | 64))) return isRoot ? "" : fromContent(node, walk);
  }
  if (!walk.isReferenced) {
    const labels =
      referenced(node, "aria-labelledby") ?? node.rare?.references?.$get("internals ariaLabelledByElements");
    const name = fromAll(labels ?? [], walk, true);
    if (hasText(name)) return name;
  }
  const role = roleOf(node);
  if (node !== walk.root) {
    const value = embeddedValue(node, role, walk);
    if (value !== undefined) return value;
  }
  const label = getAttr(node, "aria-label") ?? node.rare?.same?.$get("internals")?.ariaLabel ?? null;
  if (hasText(label) && !isHtml(node, "slot")) return label;
  const native = role === "none" ? null : nativeName(node, walk);
  if (hasText(native)) return native;
  if (!isRoot || namedByContent.$has(role) || isHtml(node, "summary") || isHtml(node, "label")) {
    const content = fromContent(node, walk);
    if (hasText(content) || (!isRoot && !hasAttr(node, "title"))) return content;
  }
  return (
    getAttr(node, "title") ??
    (isRoot ? (getAttr(node, "placeholder") ?? getAttr(node, "aria-placeholder")) : null) ??
    ""
  );
}

function nameOf(node: N): string {
  return splitTokens(compute(node, { root: node, seen: new Set(), isReferenced: false, showsHidden: false })).join(" ");
}

function descriptionOf(node: N): string {
  const walk = { root: node, seen: new Set<N>(), isReferenced: true, showsHidden: false };
  return splitTokens(fromAll(referenced(node, "aria-describedby") ?? [], walk, true)).join(" ");
}

export default { descriptionOf, isHidden, isHiddenAbove, nameOf, namedByContent, roleOf };
