// https://html.spec.whatwg.org/multipage/parsing.html
const core = require("internal/desktop/dom/core");
const { attachShadow, locateNamespace, pseudoAttributes } = require("internal/desktop/dom/node");
const { decodeEntity } = require("internal/desktop/dom/engine");

const { ELEMENT, TEXT, CDATA, INSTRUCTION, COMMENT, DOCUMENT, DOCTYPE, HTML, SVG, MATHML } = core;
const { XLINK_NS, XML_NS, XMLNS_NS, asciiLower, flags, getAttr, hooks, isHtml, splitTokens } = core;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;
type Tag = { name: string; attrs: string[]; selfClosing: boolean };

const set = (names: string) => new Set<string>(splitTokens(names));

// ───────────────────────────── character references ─────────────────────────────

const withoutSemicolon =
  set(`AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT
  Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml
  Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute
  ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp not
  ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3 szlig
  thorn times uacute ucirc ugrave uml uuml yacute yen yuml`);
const windows1252 = "€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ";
const commonEntities = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: "\xa0", apos: "'" };

function numericReference(digits: string, radix: number): string {
  const code = parseInt(digits, radix);
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
  return code >= 0x80 && code <= 0x9f ? windows1252[code - 0x80] : String.fromCodePoint(code);
}

const reference = /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z0-9]+)(;?))/g;
function decode(text: string, inAttribute: boolean): string {
  if (!text.includes("&")) return text;
  return text.replace(reference, (all, hex, decimal, name, semicolon, index) => {
    if (hex !== undefined) return numericReference(hex, 16);
    if (decimal !== undefined) return numericReference(decimal, 10);
    if (semicolon) {
      const known = Object.hasOwn(commonEntities, name) ? commonEntities[name] : decodeEntity(name);
      if (known) return known;
    }
    for (let length = Math.min(name.length, 6); length > 1; length--) {
      const prefix = name.slice(0, length);
      if (!withoutSemicolon.$has(prefix)) continue;
      if (inAttribute && (length < name.length || text[index + all.length] === "=")) return all;
      return decodeEntity(prefix) + name.slice(length) + semicolon;
    }
    return all;
  });
}

// ───────────────────────────── tables ─────────────────────────────

const special =
  set(`address applet area article aside base basefont bgsound blockquote body br button caption center col
  colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head
  header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript
  object ol p param plaintext pre script search section select source style summary table tbody td template textarea
  tfoot th thead title tr track ul wbr xmp`);
const formatting = set("a b big code em font i nobr s small strike strong tt u");
const scopeBase = "applet caption html table td th marquee object select template";
const defaultScope = set(scopeBase);
const listItemScope = set(scopeBase + " ol ul");
const buttonScope = set(scopeBase + " button");
const tableScope = set("html table template");
const impliedEnd = set("dd dt li optgroup option p rb rp rt rtc");
const impliedEndThoroughly = set("caption colgroup dd dt li optgroup option p rb rp rt rtc tbody td tfoot th thead tr");
const closesP = set(`address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer
  header hgroup main menu nav ol p search section summary ul`);
const blockEnd =
  set(`address article aside blockquote button center details dialog dir div dl fieldset figcaption figure
  footer header hgroup listing main menu nav ol pre search section select summary ul`);
const headings = set("h1 h2 h3 h4 h5 h6");
/** What is deeper becomes a sibling, as in Chromium. */
const MAX_DEPTH = 512;
const MAX_XML_DEPTH = 5000;
const MAX_ATTRIBUTES = 4096;
const headTags = set("base basefont bgsound link meta noframes script style template title");
const tableParts = set("caption col colgroup tbody td tfoot th thead tr");
const rowGroups = set("tbody tfoot thead");
const fosterTargets = set("table tbody tfoot thead tr");
const leavesForeign = set(`b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li
  listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var`);
const mathText = set("mi mo mn ms mtext");
const svgHtml = set("foreignObject desc title");
const voids = set("area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr");
const rawText = set("style script xmp iframe noembed noframes plaintext");

const byLower = (names: string) => new Map<string, string>(splitTokens(names).map(it => [it.toLowerCase(), it]));
const svgTags = byLower(`altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend
  feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight
  feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset
  fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient
  textPath`);
const svgAttributes = byLower(`attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits
  diffuseConstant edgeMode filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints
  keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits
  numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha
  preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant
  specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX
  targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan`);
const foreignAttributes = new Map<string, string>([
  ...splitTokens("actuate arcrole href role show title type").map(name => ["xlink:" + name, XLINK_NS] as const),
  ["xml:lang", XML_NS],
  ["xml:space", XML_NS],
  ["xmlns", XMLNS_NS],
  ["xmlns:xlink", XMLNS_NS],
]);

const quirksPublicId =
  /^(?:\+\/\/silmaril\/\/|-\/\/(?:as|advasoft ltd|ietf|metrius|microsoft|netscape comm\. corp\.|o'reilly and associates|sq|softquad(?: software)?|spyglass|sun microsystems corp\.|w3o|webtechs)\/\/|-\/\/w3c\/\/dtd (?:html (?:3|4\.0 (?:frameset|transitional)|experimental)|w3 html)|-\/w3c\/dtd html 4\.0 transitional\/en$|html$)/;

const enum M {
  Initial,
  BeforeHtml,
  BeforeHead,
  InHead,
  InHeadNoscript,
  AfterHead,
  InBody,
  Text,
  InTable,
  InCaption,
  InColumnGroup,
  InTableBody,
  InRow,
  InCell,
  InTemplate,
  AfterBody,
  InFrameset,
  AfterFrameset,
  AfterAfterFrameset,
  AfterAfterBody,
}

const enum Content {
  Data,
  Rcdata,
  Rawtext,
  Script,
  Plaintext,
}

const isSpace = (code: number) => code === 32 || code === 10 || code === 9 || code === 12;
const isAlpha = (code: number) => (code | 32) >= 97 && (code | 32) <= 122;
const leadingSpace = /^[\t\n\f\r ]*/;
const tagNameEnd = /[\t\n\f \/>]/g;
const attributeNameEnd = /[\t\n\f \/>=]/g;
const unquotedEnd = /[\t\n\f >]/g;
const commentEnd = /--!?>/g;
const instruction = /\?([A-Za-z_][\w-]*)(?=[\t\n\f ?>]|$)[\t\n\f ]*([^>]*)/y;
const isXmlTarget = /^xml(?:-stylesheet)?$/i;
const unfinishedText = /(?:<\/?[A-Za-z]*|&[#\w]*)$/;
const scriptPart = /<!--|-->|<\/?script(?=[\t\n\f \/>])/gi;

function search(pattern: RegExp, text: string, from: number): number {
  pattern.lastIndex = from;
  return pattern.exec(text)?.index ?? text.length;
}

function attribute(tag: Tag, name: string): string | null {
  for (let i = 0; i < tag.attrs.length; i += 2) if (tag.attrs[i] === name) return tag.attrs[i + 1];
  return null;
}

const bare = (name: string): Tag => ({ name, attrs: [], selfClosing: false });

const associatesWithForm = /^(?:button|fieldset|input|object|output|select|textarea)$/;

/** Scripts can have moved what the parser works with: then the node is dropped. */
function insertIfPossible(node: N, parent: N, before: N | null) {
  if (node.parent !== null) core.remove(node);
  try {
    core.validateInsert(node, parent, before, false);
  } catch {
    return;
  }
  core.insert(node, parent, before);
}

/** Where the content of a `<template for>` goes. */
class Patch {
  template: N;
  target: N;
  start: N;
  end: N | null;

  constructor(template: N, start: N, end: N | null) {
    this.template = template;
    this.target = start.parent!;
    this.start = start;
    this.end = end;
  }
}

function endMarkerOf(start: N): N | null {
  if (start.name === "marker") return start;
  let depth = 0;
  for (let node = start.next; node !== null; node = node.next) {
    if (node.type !== INSTRUCTION) continue;
    if (node.name === "start") depth++;
    else if (node.name === "end" && depth-- === 0) return node;
  }
  return null;
}

class Parser {
  doc: Doc;
  input = "";
  at = 0;
  ended = false;
  paused = false;
  scripts = 0;
  finished = false;
  content = Content.Data;
  contentTag = "";
  skipNewline = false;
  /** How many lines end before `counted`. */
  line = 0;
  counted = 0;

  mode = M.Initial;
  original = M.Initial;
  open: N[] = [];
  active: (N | null)[] = [];
  templateModes: M[] = [];
  patches: Patch[] = [];
  endsWithReturn = false;
  isFromScript = false;
  endsAfterScript = false;
  head: N | null = null;
  form: N | null = null;
  context: N | null = null;
  framesetOk = true;
  foster = false;
  scripting: boolean;
  allowShadow = false;
  /** What the formatting elements were made from. */
  tags = new Map<N, Tag>();
  speculations = 0;
  speculatedLength = 0;
  isInserting = false;
  /** It is still open. */
  option: N | null = null;
  optionDepth = 0;
  allowsPatches = true;
  startsScripts = false;
  /** Called for each `</script>`. It may set `paused`. */
  onScript: ((script: N) => void) | null = null;
  onEnd: (() => void) | null = null;
  xml: Generator<void> | null = null;

  constructor(doc: Doc) {
    this.doc = doc;
    this.scripting = doc.page !== null;
  }

  write(text: string) {
    if (text === "") return;
    if (this.endsWithReturn && text[0] === "\n") text = text.slice(1);
    this.endsWithReturn = text.endsWith("\r");
    if (text.includes("\r")) text = text.replace(/\r\n?/g, "\n");
    this.countLines();
    this.input = this.input.slice(this.at) + text;
    this.at = this.counted = 0;
  }

  countLines() {
    if (this.onScript === null || this.scripts > 0) return;
    const { input, at } = this;
    for (let end = input.indexOf("\n", this.counted); end >= 0 && end < at; end = input.indexOf("\n", end + 1))
      this.line++;
    this.counted = at;
  }

  /** What `run` writes is parsed before the rest of the input. */
  whileWriting(run: () => void) {
    const { ended } = this;
    const rest = this.input.slice(this.at);
    this.countLines();
    this.input = "";
    this.at = this.counted = 0;
    this.ended = false;
    this.scripts++;
    try {
      run();
    } finally {
      this.scripts--;
      this.ended = ended || (this.endsAfterScript && this.scripts === 0);
      this.endsWithReturn = false;
      this.write(rest);
    }
  }

  // ─────────────── tokenizer ───────────────

  run() {
    if (this.xml !== null) return this.runXml(this.xml);
    while (!this.paused && this.at < this.input.length && this.step()) if (this.option !== null) this.endOption();
    if (this.ended && !this.paused && !this.finished) {
      this.finished = true;
      this.endOfFile();
      this.optionDepth = -1;
      if (this.option !== null) this.endOption();
      this.onEnd?.();
    }
  }

  endOption() {
    const node = this.option!;
    if (this.open[this.optionDepth] === node) return;
    this.option = null;
    node.kind.parsed?.(node);
  }

  abort() {
    this.paused = this.finished = true;
  }

  startXml(source: string) {
    this.xml = xmlSteps(source, this.doc.node, null, this);
  }

  runXml(steps: Generator<void>) {
    let done = false;
    try {
      while (!this.paused && !(done = steps.next().done === true));
    } catch (error) {
      reportXmlError(this.doc, error as Error);
      done = true;
    }
    if (done && !this.finished) {
      this.finished = true;
      this.onEnd?.();
    }
  }

  /** False if it needs more input. */
  step(): boolean {
    const { input, at } = this;
    if (this.content !== Content.Data) return this.stepInText();
    const open = input.indexOf("<", at);
    if (open !== at) {
      if (open < 0 && !this.ended && (this.isInTable() || unfinishedText.test(input))) return false;
      this.at = open < 0 ? input.length : open;
      this.text(decode(input.slice(at, this.at), false));
      return true;
    }
    if (!this.ended && !input.includes(">", at)) return false;
    const code = input.charCodeAt(at + 1);
    if (isAlpha(code)) return this.tag(at + 1, false);
    if (code === 47) {
      const next = input.charCodeAt(at + 2);
      if (isAlpha(next)) return this.tag(at + 2, true);
      if (next === 62) this.at = at + 3;
      else if (next !== next) {
        this.at = at + 2;
        this.text("</");
      } else this.bogusComment(at + 2);
    } else if (code === 33) return this.declaration(at + 2);
    else if (code === 63) this.instruction(at + 1);
    else {
      this.at = at + 1;
      this.text("<");
    }
    return true;
  }

  stepInText(): boolean {
    const { input, at, content } = this;
    let end = input.length;
    if (content === Content.Script) {
      let escaped = 0;
      scriptPart.lastIndex = at;
      for (let match; (match = scriptPart.exec(input)) !== null;) {
        const part = match[0];
        if (part === "<!--") {
          escaped ||= 1;
          scriptPart.lastIndex -= 2;
        } else if (part === "-->") escaped = 0;
        else if (part[1] !== "/") escaped &&= 2;
        else if (escaped === 2) escaped = 1;
        else {
          end = match.index;
          break;
        }
      }
    } else if (content !== Content.Plaintext) {
      end = search(new RegExp("</" + this.contentTag + "(?=[\\t\\n\\f />])", "gi"), input, at);
    }
    if (end < input.length) this.content = Content.Data;
    else if (!this.ended) {
      if (content !== Content.Plaintext) end = unfinishedText.exec(input)?.index ?? end;
      if (content === Content.Script || end <= at) return false;
    }
    this.at = end;
    if (end > at) {
      const text = input.slice(at, end).replaceAll("\0", "�");
      this.text(content === Content.Rcdata ? decode(text, false) : text);
    }
    return true;
  }

  tag(at: number, isEnd: boolean): boolean {
    const { input } = this;
    const length = input.length;
    let end = search(tagNameEnd, input, at);
    const tag = bare(asciiLower(input.slice(at, end)));
    for (at = end; ;) {
      let code = input.charCodeAt(at);
      while (isSpace(code)) code = input.charCodeAt(++at);
      if (at >= length) {
        if (this.ended) this.at = length;
        return this.ended;
      }
      if (code === 62) break;
      if (code === 47) {
        tag.selfClosing = input.charCodeAt(++at) === 62;
        continue;
      }
      end = search(attributeNameEnd, input, at + 1);
      const name = asciiLower(input.slice(at, end));
      let value = "";
      at = end;
      while (isSpace(input.charCodeAt(at))) at++;
      if (input.charCodeAt(at) === 61) {
        at++;
        while (isSpace((code = input.charCodeAt(at)))) at++;
        if (code === 34 || code === 39) {
          end = input.indexOf(input[at], at + 1);
          if (end < 0) end = length;
          value = input.slice(at + 1, end);
          at = end + 1;
        } else {
          end = search(unquotedEnd, input, at);
          value = input.slice(at, end);
          at = end;
        }
        value = decode(value, true).replaceAll("\0", "�");
      }
      if (tag.attrs.length < 2 * MAX_ATTRIBUTES && attribute(tag, name) === null)
        tag.attrs.push(name.replaceAll("\0", "�"), value);
    }
    this.at = at + 1;
    this.skipNewline = false;
    tag.name = tag.name.replaceAll("\0", "�");
    if (isEnd) this.endTag(tag.name);
    else this.startTag(tag);
    return true;
  }

  bogusComment(at: number) {
    let end = this.input.indexOf(">", at);
    if (end < 0) end = this.input.length;
    this.at = end + 1;
    this.comment(this.input.slice(at, end));
  }

  instruction(at: number) {
    instruction.lastIndex = at;
    const match = instruction.exec(this.input);
    if (match !== null && !isXmlTarget.test(match[1])) {
      this.at = instruction.lastIndex + 1;
      if (this.at <= this.input.length) this.comment(match[2].replace(/\?$/, ""), match[1]);
    } else if (at + 1 < this.input.length) this.bogusComment(at);
    else this.at = at + 1;
  }

  declaration(at: number): boolean {
    const { input } = this;
    if (input.startsWith("--", at)) {
      at += 2;
      const abrupt = input[at] === ">" ? 1 : input.startsWith("->", at) ? 2 : 0;
      const end = abrupt ? at : search(commentEnd, input, at);
      if (end === input.length && !this.ended) return false;
      this.at = abrupt ? at + abrupt : end === input.length ? end : input.indexOf(">", end) + 1;
      const data = input.slice(at, end);
      this.comment(end === input.length ? data.replace(/--?!?$/, "") : data);
    } else if (/^doctype$/i.test(input.substr(at, 7))) {
      let end = input.indexOf(">", at);
      if (end < 0) end = input.length;
      this.at = end + 1;
      this.doctype(input.slice(at + 7, end), end === input.length);
    } else if (input.startsWith("[CDATA[", at) && (this.adjusted()?.ns ?? HTML) !== HTML) {
      let end = input.indexOf("]]>", at);
      if (end < 0 && !this.ended) return false;
      if (end < 0) end = input.length;
      this.at = end + 3;
      if (end > at + 7) this.text(input.slice(at + 7, end));
    } else this.bogusComment(at);
    return true;
  }

  // ─────────────── the stack ───────────────

  current(): N {
    return this.open[this.open.length - 1];
  }

  isInTable(): boolean {
    return this.mode === M.InTable || this.mode === M.InTableBody || this.mode === M.InRow;
  }

  adjusted(): N | undefined {
    return this.context !== null && this.open.length === 1 ? this.context : this.current();
  }

  currentIs(name: string) {
    return isHtml(this.current() ?? null, name);
  }

  currentIn(names: Set<string>) {
    const node = this.current();
    return node.ns === HTML && names.$has(node.name);
  }

  isSpecial(node: N) {
    if (node.ns === HTML) return special.$has(node.name);
    return node.ns === SVG ? svgHtml.$has(node.name) : mathText.$has(node.name) || node.name === "annotation-xml";
  }

  inScope(name: string | Set<string> | N, scope = defaultScope): boolean {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const node = this.open[i];
      if (node.ns === HTML) {
        if (typeof name === "string" ? node.name === name : node === name || ($isSet(name) && name.$has(node.name))) {
          return true;
        }
        if (scope.$has(node.name)) return false;
      } else if (scope !== tableScope && this.isSpecial(node)) return false;
    }
    return false;
  }

  lastOpen(name: string): number {
    return this.open.findLastIndex(node => isHtml(node, name));
  }

  popUntil(name: string) {
    while (this.open.length > 0 && !isHtml(this.open.pop()!, name));
  }

  popTo(names: string) {
    const wanted = set(names + " html template");
    while (!this.currentIn(wanted)) this.open.pop();
  }

  generateEnd(except?: string, names = impliedEnd) {
    while (this.currentIn(names) && this.current().name !== except) this.open.pop();
  }

  closeP() {
    if (!this.inScope("p", buttonScope)) return;
    this.generateEnd("p");
    this.popUntil("p");
  }

  place(target: N = this.current()): [N, N | null] {
    let parent = target;
    if (this.foster && target.ns === HTML && fosterTargets.$has(target.name)) {
      const template = this.lastOpen("template");
      const table = this.lastOpen("table");
      if (template > table) parent = this.open[template];
      else if (table < 0) parent = this.open[0];
      else if (this.open[table].parent !== null) {
        parent = this.open[table].parent!;
        return isHtml(parent, "template") ? [parent.x, null] : [parent, this.open[table]];
      } else parent = this.open[table - 1];
    }
    if (!isHtml(parent, "template")) return [parent, null];
    const patch = this.patches.at(-1);
    if (patch?.template !== parent) return [parent.x, null];
    return [patch.target, patch.end?.parent === patch.target ? patch.end : null];
  }

  create(tag: Tag, ns: number, parent: N): N {
    const { doc } = parent;
    const runsScript = this.context === null && doc.page !== null;
    const is = attribute(tag, "is");
    const mayConstruct = runsScript && ns === HTML && (is !== null || tag.name.includes("-"));
    if (mayConstruct) {
      this.doc.forbidsMarkupInsertion++;
      hooks.beforeConstructing(parent, tag.name, is);
    }
    if (ns === HTML && attribute(tag, "customelementregistry") !== null)
      core.setRegistry(core.noteScopedRegistry(), doc);
    else if (core.hasScopedRegistries() && parent.type !== core.FRAGMENT)
      core.setRegistry(core.registryOf(parent), doc);
    else if (parent.flags & flags.SHADOW_ROOT) core.setRegistry(core.registryOf(parent), doc);
    const node = core.createElement(doc, tag.name, ns, is, runsScript);
    core.setRegistry(undefined);
    if (tag.name === "script" && node.x !== null) {
      node.x.parserInserted = this.onScript !== null;
      node.x.forceAsync = !node.x.parserInserted;
      node.x.parserDoc = doc;
      this.countLines();
      node.x.line = this.line;
      node.x.column = this.at - this.input.lastIndexOf("\n", this.at - 1) - 1;
      node.x.started = this.onScript === null && !this.startsScripts;
    }
    const { attrs } = tag;
    for (let i = 0; i < attrs.length; i += 2) {
      if (ns === HTML) core.setAttr(node, attrs[i], attrs[i + 1]);
      else core.setAttrNS(node, attrs[i], attrs[i + 1], foreignAttributes.$get(attrs[i]) ?? null);
    }
    if (mayConstruct) {
      core.react();
      this.doc.forbidsMarkupInsertion--;
    }
    return node;
  }

  insertElement(tag: Tag, ns = HTML): N {
    if (this.option !== null) this.endOption();
    const [parent, before] = this.open.length > MAX_DEPTH ? this.place(this.open[MAX_DEPTH - 1]) : this.place();
    const node = this.create(tag, ns, parent);
    if (tag.name === "option" && this.option === null) {
      this.option = node;
      this.optionDepth = this.open.length;
    }
    if (
      this.form !== null &&
      this.context === null &&
      ns === HTML &&
      (associatesWithForm.test(tag.name) || node.rare?.definition?.formAssociated)
    ) {
      if (
        !this.open.includes(this.form) &&
        this.lastOpen("template") < 0 &&
        core.rootOf(this.form) === core.rootOf(parent)
      ) {
        if (tag.name === "img" || !core.hasAttr(node, "form")) core.rare(node).parserForm = this.form;
      }
    }
    this.isInserting = !(node.flags & flags.CUSTOM);
    if (node.flags & flags.CUSTOM || parent.type === DOCUMENT) insertIfPossible(node, parent, before);
    else core.insert(node, parent, before);
    this.isInserting = false;
    if (this.context === null) core.react();
    this.open.push(node);
    return node;
  }

  isInTemplate(): boolean {
    return this.lastOpen("template") >= 0 || core.isHtml(this.context, "template");
  }

  insertVoid(tag: Tag) {
    this.insertElement(tag);
    this.open.pop();
  }

  insertForeign(tag: Tag, ns: number) {
    const { attrs } = tag;
    for (let i = 0; i < attrs.length; i += 2) {
      if (ns === SVG) attrs[i] = svgAttributes.$get(attrs[i]) ?? attrs[i];
      else if (attrs[i] === "definitionurl") attrs[i] = "definitionURL";
    }
    if (ns === SVG) tag.name = svgTags.$get(tag.name) ?? tag.name;
    this.insertElement(tag, ns);
    if (tag.selfClosing) this.popForeign(this.open.length - 1);
  }

  popForeign(index: number) {
    const node = this.open[index];
    const wasCurrent = node === this.current();
    this.open.length = index;
    if (wasCurrent && node.name === "script" && node.ns === SVG) this.onScript?.(node);
  }

  insertText(text: string) {
    if (text === "") return;
    const [parent, before] = this.place();
    if (parent.type === DOCUMENT) return;
    const previous = before === null ? parent.last : before.prev;
    if (previous !== null && previous.type === TEXT) core.replaceData(previous, previous.data.length, 0, text);
    else core.insert(core.createText(parent.doc, text), parent, before);
  }

  insertRaw(tag: Tag, content: Content) {
    this.insertElement(tag);
    this.content = content;
    this.contentTag = tag.name;
    this.original = this.mode;
    this.mode = M.Text;
  }

  copy(node: N): Tag {
    return this.tags.$get(node)!;
  }

  reconstruct() {
    const { active, open } = this;
    let i = active.length;
    while (i > 0 && active[i - 1] !== null && !open.includes(active[i - 1]!)) i--;
    for (; i < active.length; i++) {
      const tag = this.copy(active[i]!);
      this.tags.$set((active[i] = this.insertElement(tag)), tag);
    }
  }

  pushFormatting(tag: Tag) {
    const node = this.insertElement(tag);
    const { attrs } = tag;
    this.tags.$set(node, tag);
    const isSame = (other: N) =>
      other.name === node.name &&
      this.copy(other).attrs.length === attrs.length &&
      attrs.every((it, i) => i % 2 === 1 || attribute(this.copy(other), it) === attrs[i + 1]);
    let count = 0;
    for (let i = this.active.length - 1; i >= 0 && this.active[i] !== null; i--) {
      if (isSame(this.active[i]!) && ++count === 3) {
        this.active.splice(i, 1);
        break;
      }
    }
    this.active.push(node);
  }

  clearFormatting() {
    while (this.active.length > 0 && this.active.pop() !== null);
  }

  findFormatting(name: string): N | null {
    for (let i = this.active.length - 1; i >= 0 && this.active[i] !== null; i--) {
      if (this.active[i]!.name === name) return this.active[i];
    }
    return null;
  }

  adoptionAgency(name: string) {
    const { open, active } = this;
    if (this.currentIs(name) && !active.includes(this.current())) return void open.pop();
    for (let outer = 0; outer < 8; outer++) {
      const element = this.findFormatting(name);
      if (element === null) return this.anyOtherEnd(name);
      const index = open.indexOf(element);
      if (index < 0) return void active.splice(active.indexOf(element), 1);
      if (!this.inScope(element)) return;
      const furthestIndex = open.findIndex((node, i) => i > index && this.isSpecial(node));
      if (furthestIndex < 0) {
        open.length = index;
        return void active.splice(active.indexOf(element), 1);
      }
      const furthest = open[furthestIndex];
      let bookmark = active.indexOf(element);
      let last = furthest;
      for (let at = furthestIndex - 1, inner = 1; open[at] !== element; at--, inner++) {
        let entry = active.indexOf(open[at]);
        if (inner > 3 && entry >= 0) {
          active.splice(entry, 1);
          if (entry < bookmark) bookmark--;
          entry = -1;
        }
        if (entry < 0) {
          open.splice(at, 1);
          continue;
        }
        const tag = this.copy(open[at]);
        const node = (active[entry] = open[at] = this.create(tag, HTML, element));
        this.tags.$set(node, tag);
        if (last === furthest) bookmark = entry + 1;
        insertIfPossible(last, node, null);
        last = node;
      }
      const [parent, before] = this.place(open[index - 1]);
      insertIfPossible(last, parent, before);
      const replacement = this.create(this.copy(element), HTML, element);
      this.tags.$set(replacement, this.copy(element));
      while (furthest.first !== null) insertIfPossible(furthest.first, replacement, null);
      insertIfPossible(replacement, furthest, null);
      const old = active.indexOf(element);
      active.splice(old, 1);
      active.splice(old < bookmark ? bookmark - 1 : bookmark, 0, replacement);
      open.splice(open.indexOf(element), 1);
      open.splice(open.indexOf(furthest) + 1, 0, replacement);
    }
  }

  anyOtherEnd(name: string) {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const node = this.open[i];
      if (isHtml(node, name)) {
        this.generateEnd(name);
        this.open.length = i;
        return;
      }
      if (this.isSpecial(node)) return;
    }
  }

  resetMode() {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const isLast = i === 0;
      const node = isLast && this.context !== null ? this.context : this.open[i];
      const name = node.ns === HTML ? node.name : "";
      if ((name === "td" || name === "th") && !isLast) return (this.mode = M.InCell);
      if (name === "tr") return (this.mode = M.InRow);
      if (rowGroups.$has(name)) return (this.mode = M.InTableBody);
      if (name === "caption") return (this.mode = M.InCaption);
      if (name === "colgroup") return (this.mode = M.InColumnGroup);
      if (name === "table") return (this.mode = M.InTable);
      if (name === "template") return (this.mode = this.templateModes[this.templateModes.length - 1]);
      if (name === "head" && !isLast) return (this.mode = M.InHead);
      if (name === "body") return (this.mode = M.InBody);
      if (name === "frameset") return (this.mode = M.InFrameset);
      if (name === "html") return (this.mode = this.head === null ? M.BeforeHead : M.AfterHead);
    }
    this.mode = M.InBody;
  }

  isHtmlIntegration(node: N) {
    if (node.ns === SVG) return svgHtml.$has(node.name);
    return (
      node.name === "annotation-xml" &&
      node.ns === MATHML &&
      /^(?:text\/html|application\/xhtml\+xml)$/i.test(getAttr(node, "encoding") ?? "")
    );
  }

  /** The "anything else" of the modes before the body. */
  advance() {
    switch (this.mode) {
      case M.Initial:
        core.setQuirks(this.doc, 2);
        return (this.mode = M.BeforeHtml);
      case M.BeforeHtml:
        return this.startHtml(bare("html"));
      case M.BeforeHead:
        this.head = this.insertElement(bare("head"));
        return (this.mode = M.InHead);
      case M.InHead:
        this.open.pop();
        return (this.mode = M.AfterHead);
      case M.InHeadNoscript:
        this.open.pop();
        return (this.mode = M.InHead);
      default:
        this.insertElement(bare("body"));
        this.framesetOk = true;
        this.mode = M.InBody;
    }
  }

  startHtml(tag: Tag) {
    const node = this.create(tag, HTML, this.doc.node);
    core.insert(node, this.doc.node, null);
    this.open.push(node);
    this.mode = M.BeforeHead;
  }

  // ─────────────── tokens ───────────────

  doctype(source: string, isCutOff: boolean) {
    if (this.mode !== M.Initial) return;
    const match =
      /^\s*(\S*)\s*(?:public\s*(?:"([^"]*)"?|'([^']*)'?)\s*(?:"([^"]*)"?|'([^']*)'?)?|system\s*(?:"([^"]*)"?|'([^']*)'?)|(.*))/is.exec(
        source,
      )!;
    const name = asciiLower(match[1]);
    const publicId = match[2] ?? match[3];
    const systemId = match[4] ?? match[5] ?? match[6] ?? match[7];
    core.insert(core.createDoctype(this.doc, name, publicId ?? "", systemId ?? ""), this.doc.node, null);
    const lower = asciiLower(publicId ?? "");
    const isLoose = /^-\/\/w3c\/\/dtd html 4\.01 (?:frameset|transitional)\/\//.test(lower);
    const isQuirky =
      isCutOff ||
      name !== "html" ||
      !!match[8] ||
      quirksPublicId.test(lower) ||
      (isLoose && !systemId) ||
      asciiLower(systemId ?? "") === "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd";
    const isLimited = isLoose || /^-\/\/w3c\/\/dtd xhtml 1\.0 (?:frameset|transitional)\/\//.test(lower);
    core.setQuirks(this.doc, isQuirky ? 2 : isLimited ? 1 : 0);
    this.mode = M.BeforeHtml;
  }

  comment(data: string, target?: string) {
    this.skipNewline = false;
    let parent: N;
    let before: N | null = null;
    if (
      this.mode <= M.BeforeHtml ||
      ((this.mode === M.AfterAfterBody || this.mode === M.AfterAfterFrameset) && this.context === null)
    )
      parent = this.doc.node;
    else if (this.mode === M.AfterBody) parent = this.open[0];
    else [parent, before] = this.place();
    core.insert(
      core.createData(parent.doc, target ? INSTRUCTION : COMMENT, data.replaceAll("\0", "�"), target),
      parent,
      before,
    );
  }

  text(text: string) {
    if (this.skipNewline) {
      this.skipNewline = false;
      if (text[0] === "\n") text = text.slice(1);
    }
    const node = this.adjusted();
    if (node !== undefined && node.ns !== HTML) {
      if (!(node.ns === MATHML && mathText.$has(node.name)) && !this.isHtmlIntegration(node)) {
        if (/[^\t\n\f\r \0]/.test(text)) this.framesetOk = false;
        return this.insertText(text.replaceAll("\0", "�"));
      }
    }
    while (text !== "") {
      const mode = this.mode;
      if (mode === M.Text) return this.insertText(text);
      if (mode === M.InBody || mode === M.InCell || mode === M.InCaption || mode === M.InTemplate) {
        return this.textInBody(text);
      }
      const spaces = leadingSpace.exec(text)![0];
      if (this.isInTable()) {
        text = text.replaceAll("\0", "");
        if (!/[^\t\n\f\r ]/.test(text) && (this.currentIn(fosterTargets) || this.currentIs("template"))) {
          return this.insertText(text);
        }
        this.foster = true;
        this.textInBody(text);
        this.foster = false;
        return;
      }
      if (mode === M.InFrameset || mode === M.AfterFrameset || mode === M.AfterAfterFrameset)
        return this.insertText(text.replace(/[^\t\n\f\r ]/g, ""));
      if (mode === M.AfterBody || mode === M.AfterAfterBody) {
        if (spaces !== text) this.mode = M.InBody;
        return this.textInBody(text);
      }
      if (mode >= M.InHead) this.insertText(spaces);
      text = text.slice(spaces.length);
      if (text === "") return;
      if (mode !== M.InColumnGroup) this.advance();
      else if (!this.currentIs("colgroup")) text = text.slice(1);
      else {
        this.open.pop();
        this.mode = M.InTable;
      }
    }
  }

  textInBody(text: string) {
    if (text.includes("\0")) text = text.replaceAll("\0", "");
    if (text === "") return;
    if (this.active.length > 0) this.reconstruct();
    this.insertText(text);
    if (this.framesetOk && /[^\t\n\f\r ]/.test(text)) this.framesetOk = false;
  }

  startTag(tag: Tag) {
    const node = this.adjusted();
    const { name } = tag;
    if (
      node === undefined ||
      node.ns === HTML ||
      (node.ns === MATHML && mathText.$has(node.name) && name !== "mglyph" && name !== "malignmark") ||
      (node.ns === MATHML && node.name === "annotation-xml" && name === "svg") ||
      this.isHtmlIntegration(node)
    ) {
      return this.start(tag);
    }
    if (
      leavesForeign.$has(name) ||
      (name === "font" && ["color", "face", "size"].some(it => attribute(tag, it) !== null))
    ) {
      this.leaveForeign();
      return this.start(tag);
    }
    this.insertForeign(tag, node.ns);
  }

  leaveForeign() {
    for (let node; (node = this.current()).ns !== HTML; this.open.pop()) {
      if ((node.ns === MATHML && mathText.$has(node.name)) || this.isHtmlIntegration(node)) break;
    }
  }

  endTag(name: string) {
    if ((this.adjusted()?.ns ?? HTML) === HTML) return this.end(name);
    if (name === "br" || name === "p") {
      this.leaveForeign();
      return this.end(name);
    }
    for (let i = this.open.length - 1; i > 0; i--) {
      if (asciiLower(this.open[i].name) === name) return this.popForeign(i);
      if (this.open[i - 1].ns === HTML) return this.end(name);
    }
  }

  start(tag: Tag): unknown {
    const { name } = tag;
    const mode = this.mode;
    if (name === "html" && mode > M.BeforeHtml) return this.startInBody(tag);
    switch (mode) {
      case M.BeforeHtml:
        if (name === "html") return this.startHtml(tag);
        break;
      case M.BeforeHead:
        if (name !== "head") break;
        this.head = this.insertElement(tag);
        return (this.mode = M.InHead);
      case M.InHead:
        if (name === "head") return;
        if (headTags.$has(name) || name === "noscript") return this.startInHead(tag);
        break;
      case M.InHeadNoscript:
        if (name === "head" || name === "noscript") return;
        if (/^(?:basefont|bgsound|link|meta|noframes|style)$/.test(name)) return this.startInHead(tag);
        break;
      case M.AfterHead:
        if (name === "head") return;
        if (name === "body" || name === "frameset") {
          this.insertElement(tag);
          this.framesetOk = false;
          return (this.mode = name === "body" ? M.InBody : M.InFrameset);
        }
        if (!headTags.$has(name)) break;
        this.open.push(this.head!);
        this.startInHead(tag);
        return this.open.splice(this.open.indexOf(this.head!), 1);
      case M.InBody:
        return this.startInBody(tag);
      case M.InTable:
        return this.startInTable(tag);
      case M.InCaption:
        if (!tableParts.$has(name)) return this.startInBody(tag);
        return this.closeCaption() && this.start(tag);
      case M.InColumnGroup:
        if (name === "col") return this.insertVoid(tag);
        if (name === "template") return this.startInHead(tag);
        if (!this.currentIs("colgroup")) return;
        this.open.pop();
        this.mode = M.InTable;
        return this.start(tag);
      case M.InTableBody:
        if (name === "tr" || name === "td" || name === "th") {
          this.popTo("tbody tfoot thead");
          this.insertElement(name === "tr" ? tag : bare("tr"));
          this.mode = M.InRow;
          return name === "tr" || this.start(tag);
        }
        if (!tableParts.$has(name)) return this.startInTable(tag);
        return this.closeRowGroup() && this.start(tag);
      case M.InRow:
        if (name === "td" || name === "th") {
          this.popTo("tr");
          this.insertElement(tag);
          this.active.push(null);
          return (this.mode = M.InCell);
        }
        if (!tableParts.$has(name)) return this.startInTable(tag);
        return this.closeRow() && this.start(tag);
      case M.InCell:
        if (!tableParts.$has(name)) return this.startInBody(tag);
        if (!this.inScope("td", tableScope) && !this.inScope("th", tableScope)) return;
        this.closeCell();
        return this.start(tag);
      case M.InTemplate: {
        if (headTags.$has(name)) return this.startInHead(tag);
        let next = M.InBody;
        if (name === "col") next = M.InColumnGroup;
        else if (name === "tr") next = M.InTableBody;
        else if (name === "td" || name === "th") next = M.InRow;
        else if (tableParts.$has(name)) next = M.InTable;
        this.mode = this.templateModes[this.templateModes.length - 1] = next;
        return this.start(tag);
      }
      case M.InFrameset:
      case M.AfterFrameset:
      case M.AfterAfterFrameset:
        if (name === "frameset" && this.mode === M.InFrameset) return this.insertElement(tag);
        if (name === "frame" && this.mode === M.InFrameset) return this.insertVoid(tag);
        return name === "noframes" && this.startInHead(tag);
      case M.AfterBody:
      case M.AfterAfterBody:
        this.mode = M.InBody;
        return this.start(tag);
    }
    this.advance();
    this.start(tag);
  }

  startInHead(tag: Tag) {
    switch (tag.name) {
      case "title":
        return this.insertRaw(tag, Content.Rcdata);
      case "noscript":
        if (this.scripting) return this.insertRaw(tag, Content.Rawtext);
        this.insertElement(tag);
        return (this.mode = M.InHeadNoscript);
      case "noframes":
      case "style":
        return this.insertRaw(tag, Content.Rawtext);
      case "script":
        return this.insertRaw(tag, Content.Script);
      case "template":
        return this.startTemplate(tag);
      default:
        this.insertVoid(tag);
    }
  }

  startTemplate(tag: Tag) {
    const host = this.adjusted();
    const mode = asciiLower(attribute(tag, "shadowrootmode") ?? "");
    this.active.push(null);
    this.framesetOk = false;
    this.templateModes.push((this.mode = M.InTemplate));
    if (
      this.allowShadow &&
      (mode === "open" || mode === "closed") &&
      host !== this.open[0] &&
      !(host!.flags & flags.HOST)
    ) {
      try {
        const has = (name: string) => attribute(tag, "shadowroot" + name) !== null;
        const init = {
          delegatesFocus: has("delegatesfocus"),
          clonable: has("clonable"),
          serializable: has("serializable"),
        };
        const keepsNull = has("customelementregistry");
        const registry = keepsNull ? core.noteScopedRegistry() : core.registryOf(host!.doc.node);
        const slotAssignment = asciiLower(attribute(tag, "shadowrootslotassignment") ?? "");
        const referenceTarget = attribute(tag, "shadowrootreferencetarget");
        const root = attachShadow(host!, { mode, ...init, referenceTarget, registry, slotAssignment });
        const template = this.create(tag, HTML, host!);
        Object.assign(core.scopeOf(root), {
          declarative: true,
          availableToInternals: true,
          keepsRegistryNull: keepsNull,
        });
        template.x = root;
        return void this.open.push(template);
      } catch {}
    }
    if (!this.startPatch(tag)) this.insertElement(tag);
  }

  startPatch(tag: Tag): boolean {
    const name = attribute(tag, "for");
    if (!name || !this.allowsPatches) return false;
    const [parent] = this.place();
    const scope = isHtml(parent, "body") && this.context === null ? (parent.parent ?? parent) : parent;
    const isMarker = (node: N) => node.type === INSTRUCTION && (node.name === "start" || node.name === "marker");
    let start = scope.first;
    while (start !== null && !(isMarker(start) && pseudoAttributes(start).$get("name") === name))
      start = core.following(start, scope);
    if (start === null) return false;
    const patch = new Patch(this.create(tag, HTML, parent), start, endMarkerOf(start));
    const replaced: N[] = [];
    if (patch.end !== start) for (let node = start.next; node !== patch.end; node = node!.next) replaced.push(node!);
    this.doc.forbidsMarkupInsertion++;
    for (const node of replaced) if (node.parent !== null) core.remove(node);
    if (this.context === null) core.react();
    this.doc.forbidsMarkupInsertion--;
    this.patches.push(patch);
    this.open.push(patch.template);
    return true;
  }

  endTemplate() {
    if (this.lastOpen("template") < 0) return;
    this.generateEnd(undefined, impliedEndThoroughly);
    const template = this.open[this.lastOpen("template")];
    this.popUntil("template");
    if (this.patches.at(-1)?.template === template) {
      const { start, end } = this.patches.pop()!;
      if (start.parent !== null) core.remove(start);
      if (end?.parent) core.remove(end);
    }
    this.clearFormatting();
    this.templateModes.pop();
    this.resetMode();
  }

  addMissing(node: N, tag: Tag) {
    for (let i = 0; i < tag.attrs.length; i += 2) {
      if (!core.hasAttr(node, tag.attrs[i])) core.setAttr(node, tag.attrs[i], tag.attrs[i + 1]);
    }
  }

  startInBody(tag: Tag): unknown {
    const { name } = tag;
    if (closesP.$has(name)) {
      this.closeP();
      return this.insertElement(tag);
    }
    if (formatting.$has(name)) {
      const anchor = name === "a" ? this.findFormatting("a") : null;
      if (anchor !== null) {
        this.adoptionAgency("a");
        for (const list of [this.active, this.open]) if (list.includes(anchor)) list.splice(list.indexOf(anchor), 1);
      }
      this.reconstruct();
      if (name === "nobr" && this.inScope("nobr")) {
        this.adoptionAgency("nobr");
        this.reconstruct();
      }
      return this.pushFormatting(tag);
    }
    if (headTags.$has(name)) return this.startInHead(tag);
    if (headings.$has(name)) {
      this.closeP();
      if (this.currentIn(headings)) this.open.pop();
      return this.insertElement(tag);
    }
    if (tableParts.$has(name)) return;
    switch (name) {
      case "html":
        return this.lastOpen("template") < 0 && this.addMissing(this.open[0], tag);
      case "body":
        if (!isHtml(this.open[1] ?? null, "body") || this.lastOpen("template") >= 0) return;
        this.framesetOk = false;
        return this.addMissing(this.open[1], tag);
      case "frameset":
        if (!isHtml(this.open[1] ?? null, "body") || !this.framesetOk) return;
        if (this.open[1].parent !== null) core.remove(this.open[1]);
        this.open.length = 1;
        this.insertElement(tag);
        return (this.mode = M.InFrameset);
      case "frame":
      case "head":
        return;
      case "pre":
      case "listing":
        this.closeP();
        this.insertElement(tag);
        this.skipNewline = true;
        return (this.framesetOk = false);
      case "form": {
        const inTemplate = this.isInTemplate();
        if (this.form !== null && !inTemplate) return;
        this.closeP();
        const form = this.insertElement(tag);
        return inTemplate || (this.form = form);
      }
      case "li":
      case "dd":
      case "dt":
        this.framesetOk = false;
        for (let i = this.open.length - 1; i >= 0; i--) {
          const node = this.open[i];
          if (name === "li" ? isHtml(node, "li") : isHtml(node, "dd") || isHtml(node, "dt")) {
            this.generateEnd(node.name);
            this.popUntil(node.name);
            break;
          }
          if (this.isSpecial(node) && !/^(?:address|div|p)$/.test(node.name)) break;
        }
        this.closeP();
        return this.insertElement(tag);
      case "plaintext":
        this.closeP();
        this.insertElement(tag);
        return (this.content = Content.Plaintext);
      case "button":
        if (this.inScope("button")) {
          this.generateEnd();
          this.popUntil("button");
        }
        this.framesetOk = false;
        break;
      case "applet":
      case "marquee":
      case "object":
        this.reconstruct();
        this.insertElement(tag);
        this.active.push(null);
        return (this.framesetOk = false);
      case "table":
        if (!this.doc.quirks) this.closeP();
        this.insertElement(tag);
        this.framesetOk = false;
        return (this.mode = M.InTable);
      case "input":
        if (isHtml(this.context, "select")) return;
        if (this.inScope("select")) this.popUntil("select");
        this.reconstruct();
        this.insertVoid(tag);
        return asciiLower(attribute(tag, "type") ?? "") === "hidden" || (this.framesetOk = false);
      case "area":
      case "br":
      case "embed":
      case "img":
      case "keygen":
      case "wbr":
        this.reconstruct();
        this.insertVoid(tag);
        return (this.framesetOk = false);
      case "param":
      case "source":
      case "track":
        return this.insertVoid(tag);
      case "hr":
        this.closeP();
        if (this.inScope("select")) this.generateEnd();
        this.insertVoid(tag);
        return (this.framesetOk = false);
      case "image":
        tag.name = "img";
        return this.startInBody(tag);
      case "textarea":
        this.insertRaw(tag, Content.Rcdata);
        this.skipNewline = true;
        return (this.framesetOk = false);
      case "xmp":
      case "iframe":
      case "noembed":
        if (name === "xmp") {
          this.closeP();
          this.reconstruct();
        }
        if (name !== "noembed") this.framesetOk = false;
        return this.insertRaw(tag, Content.Rawtext);
      case "noscript":
        if (this.scripting) return this.insertRaw(tag, Content.Rawtext);
        break;
      case "select":
        if (isHtml(this.context, "select")) return;
        if (this.inScope("select")) return this.popUntil("select");
        this.framesetOk = false;
        break;
      case "option":
      case "optgroup":
        if (this.inScope("select")) this.generateEnd(name === "option" ? "optgroup" : undefined);
        else if (this.currentIs("option")) this.open.pop();
        break;
      case "rb":
      case "rtc":
      case "rp":
      case "rt":
        if (this.inScope("ruby")) this.generateEnd(name === "rp" || name === "rt" ? "rtc" : undefined);
        return this.insertElement(tag);
      case "math":
      case "svg":
        this.reconstruct();
        return this.insertForeign(tag, name === "svg" ? SVG : MATHML);
    }
    if (this.active.length > 0) this.reconstruct();
    this.insertElement(tag);
  }

  startInTable(tag: Tag): unknown {
    const { name } = tag;
    if (tableParts.$has(name)) {
      this.popTo("table");
      if (name === "caption") {
        this.active.push(null);
        this.insertElement(tag);
        return (this.mode = M.InCaption);
      }
      const isColumn = name === "col" || name === "colgroup";
      const isGroup = name === "colgroup" || rowGroups.$has(name);
      this.insertElement(isGroup ? tag : bare(isColumn ? "colgroup" : "tbody"));
      this.mode = isColumn ? M.InColumnGroup : M.InTableBody;
      return isGroup || this.start(tag);
    }
    switch (name) {
      case "table":
        if (!this.inScope("table", tableScope)) return;
        this.popUntil("table");
        this.resetMode();
        return this.start(tag);
      case "style":
      case "script":
      case "template":
        return this.startInHead(tag);
      case "input":
        if (asciiLower(attribute(tag, "type") ?? "") === "hidden") return this.insertVoid(tag);
        break;
      case "form":
        if (this.isInTemplate()) this.insertElement(tag);
        else if (this.form !== null) return;
        else this.form = this.insertElement(tag);
        return this.open.pop();
    }
    this.foster = true;
    this.startInBody(tag);
    this.foster = false;
  }

  closeCaption(): boolean {
    if (!this.inScope("caption", tableScope)) return false;
    this.generateEnd();
    this.popUntil("caption");
    this.clearFormatting();
    this.mode = M.InTable;
    return true;
  }

  closeRowGroup(): boolean {
    if (!this.inScope(rowGroups, tableScope)) return false;
    this.popTo("tbody tfoot thead");
    this.open.pop();
    this.mode = M.InTable;
    return true;
  }

  closeRow(): boolean {
    if (!this.inScope("tr", tableScope)) return false;
    this.popTo("tr");
    this.open.pop();
    this.mode = M.InTableBody;
    return true;
  }

  closeCell() {
    this.generateEnd();
    while (!this.currentIs("td") && !this.currentIs("th")) this.open.pop();
    this.open.pop();
    this.clearFormatting();
    this.mode = M.InRow;
  }

  end(name: string): unknown {
    const mode = this.mode;
    if (mode === M.Text) {
      const node = this.open.pop();
      this.mode = this.original;
      node!.kind.parsed?.(node!);
      if (name === "script" && this.onScript !== null) this.onScript(node!);
      return;
    }
    if (name === "template" && mode >= M.InHead && mode !== M.InHeadNoscript && mode <= M.InTemplate) {
      return this.endTemplate();
    }
    const isOuter = name === "body" || name === "html";
    switch (mode) {
      case M.Initial:
        break;
      case M.BeforeHtml:
      case M.BeforeHead:
        if (isOuter || name === "head" || name === "br") break;
        return;
      case M.InHead:
      case M.AfterHead:
        if (name === "head" && this.mode === M.InHead) return this.advance();
        if (isOuter || name === "br") break;
        return;
      case M.InHeadNoscript:
        if (name === "noscript") return this.advance();
        if (name === "br") break;
        return;
      case M.InBody:
        return this.endInBody(name);
      case M.InTable:
        return this.endInTable(name);
      case M.InCaption:
        if (name === "caption") return this.closeCaption();
        if (name === "table") return this.closeCaption() && this.end(name);
        return isOuter || tableParts.$has(name) || this.endInBody(name);
      case M.InColumnGroup:
        if (name === "col" || !this.currentIs("colgroup")) return;
        this.open.pop();
        this.mode = M.InTable;
        return name === "colgroup" || this.end(name);
      case M.InTableBody:
        if (rowGroups.$has(name)) return this.inScope(name, tableScope) && this.closeRowGroup();
        if (name === "table") return this.closeRowGroup() && this.end(name);
        return this.endInTable(name);
      case M.InRow:
        if (name === "tr") return this.closeRow();
        if (name === "table") return this.closeRow() && this.end(name);
        if (rowGroups.$has(name)) return this.inScope(name, tableScope) && this.closeRow() && this.end(name);
        return this.endInTable(name);
      case M.InCell:
        if (name === "td" || name === "th") return this.inScope(name, tableScope) && this.closeCell();
        if (fosterTargets.$has(name)) {
          if (!this.inScope(name, tableScope)) return;
          this.closeCell();
          return this.end(name);
        }
        return isOuter || tableParts.$has(name) || this.endInBody(name);
      case M.InTemplate:
      case M.AfterAfterFrameset:
        return;
      case M.AfterFrameset:
        return name === "html" && (this.mode = M.AfterAfterFrameset);
      case M.InFrameset:
        if (name !== "frameset" || this.open.length === 1) return;
        this.open.pop();
        return this.currentIs("frameset") || this.context !== null || (this.mode = M.AfterFrameset);
      case M.AfterBody:
      case M.AfterAfterBody:
        if (name === "html" && this.mode === M.AfterBody) {
          return this.context !== null || (this.mode = M.AfterAfterBody);
        }
        this.mode = M.InBody;
        return this.end(name);
    }
    this.advance();
    this.end(name);
  }

  endInTable(name: string) {
    if (name === "table") {
      if (!this.inScope("table", tableScope)) return;
      this.popUntil("table");
      this.resetMode();
    } else if (name !== "body" && name !== "html" && !tableParts.$has(name)) {
      this.foster = true;
      this.endInBody(name);
      this.foster = false;
    }
  }

  endInBody(name: string): unknown {
    if (blockEnd.$has(name)) {
      if (!this.inScope(name)) return;
      this.generateEnd();
      return this.popUntil(name);
    }
    if (formatting.$has(name)) return this.adoptionAgency(name);
    if (headings.$has(name)) {
      if (!this.inScope(headings)) return;
      this.generateEnd();
      while (!this.currentIn(headings)) this.open.pop();
      return this.open.pop();
    }
    switch (name) {
      case "body":
      case "html":
        if (!this.inScope("body")) return;
        this.mode = M.AfterBody;
        return name === "body" || this.end(name);
      case "form": {
        if (this.isInTemplate()) {
          if (!this.inScope("form")) return;
          this.generateEnd();
          return this.popUntil("form");
        }
        const form = this.form;
        this.form = null;
        if (form === null || !this.inScope(form)) return;
        this.generateEnd();
        return this.open.splice(this.open.indexOf(form), 1);
      }
      case "p":
        if (!this.inScope("p", buttonScope)) this.insertElement(bare("p"));
        return this.closeP();
      case "li":
      case "dd":
      case "dt":
        if (!this.inScope(name, name === "li" ? listItemScope : defaultScope)) return;
        this.generateEnd(name);
        return this.popUntil(name);
      case "applet":
      case "marquee":
      case "object":
        if (!this.inScope(name)) return;
        this.generateEnd();
        this.popUntil(name);
        return this.clearFormatting();
      case "br":
        return this.startInBody(bare("br"));
    }
    this.anyOtherEnd(name);
  }

  endOfFile() {
    if (this.mode === M.Text) {
      const node = this.open.pop();
      if (node!.name === "script") node!.x.started = true;
      node!.kind.parsed?.(node!);
      this.mode = this.original;
    }
    while (this.templateModes.length > (isHtml(this.context, "template") ? 1 : 0)) this.endTemplate();
    while (this.mode < M.InBody) this.advance();
    this.open.length = 0;
  }
}

declare global {
  namespace $Dom {
    type Parser = ParserImpl;
  }
}
type ParserImpl = Parser;

function parseDocument(doc: Doc, html: string, allowShadow = false, scripting = doc.page !== null) {
  const parser = new Parser(doc);
  parser.scripting = scripting;
  parser.allowShadow = allowShadow;
  parser.ended = true;
  parser.write(html);
  parser.run();
}

function parseFragment(context: N, html: string, allowShadow = false, withScripts = false, registryFrom = context): N {
  if (context.doc.isHtml) return parseHtmlFragment(context, html, allowShadow, withScripts, registryFrom, false);
  const fragment = core.createFragment(isHtml(context, "template") ? context.x.doc : context.doc);
  parseXml(html, fragment, context);
  return fragment;
}

function parseHtmlFragment(
  context: N,
  html: string,
  allowShadow: boolean,
  withScripts: boolean,
  registryFrom: N,
  isInert: boolean,
): N {
  const owner = isInert || isHtml(context, "template") ? core.templateDoc(context.doc) : context.doc;
  const fragment = core.createFragment(owner);
  const parser = new Parser(context.doc);
  const root = core.createPlainElement(owner, "html", HTML);
  if (!isHtml(context, "template") && registryFrom.rare !== null) core.rare(root).registry = registryFrom.rare.registry;
  const name = context.ns === HTML ? context.name : "";
  parser.startsScripts = withScripts;
  parser.context = context;
  parser.allowsPatches = !isInert;
  parser.allowShadow = allowShadow;
  parser.open.push(root);
  if (name === "title" || name === "textarea") parser.content = Content.Rcdata;
  else if (rawText.$has(name) || (name === "noscript" && parser.scripting)) parser.content = Content.Plaintext;
  else if (name === "template") parser.templateModes.push(M.InTemplate);
  parser.contentTag = "\0";
  parser.resetMode();
  parser.form = core.closestHtml(context, "form");
  parser.ended = true;
  parser.write(html);
  parser.run();
  while (root.first !== null) core.insert(root.first, fragment, null, true);
  return fragment;
}

// ───────────────────────────── XML ─────────────────────────────

const xmlToken =
  /<!--([^]*?)-->|<!\[CDATA\[([^]*?)\]\]>|<\?([^\s?]+)\s*([^]*?)\?>|<!DOCTYPE\s+([^\s>\[]+)((?:[^>\["']|"[^"]*"|'[^']*'|\[[^]*?\])*)>|<\/([^\s>]+)\s*>|<([^\s<>\/=!?"']+)((?:\s+[^\s<>\/="']+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/y;
const xmlName = /^(?:[A-Za-z_\x80-\uffff][\w.\-\x80-\uffff]*:)?[A-Za-z_\x80-\uffff][\w.\-\x80-\uffff]*$/;
const xmlAttribute = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseXml(source: string, root: N, context: N | null) {
  xmlSteps(source, root, context, null).next();
}

const entityReference = /&([^\s;&<#]+);/g;

/** Yields after each script that `loader` was given. */
function* xmlSteps(source: string, root: N, context: N | null, loader: Parser | null): Generator<void> {
  let hasHtmlEntities = false;
  let expansions = 0;
  let room = source.length * 10 + 1_000_000;
  const fail = (message: string): never => {
    throw core.domError("SyntaxError", message);
  };
  const entities = new Map<string, string>();
  const decodeXml = (text: string) =>
    text.replace(/&(?:#x([0-9a-fA-F]+);|#([0-9]+);|([^\s;&<]+);|)/g, (_, hex, decimal, name) => {
      if (hex ?? decimal) return String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10));
      if (name === undefined) return fail("A '&' has to start a reference");
      const isPredefined = name !== "nbsp" && Object.hasOwn(commonEntities, name);
      if (isPredefined) return commonEntities[name];
      const known = entities.$get(name) ?? (hasHtmlEntities ? decode(`&${name};`, false) : undefined);
      if ((room -= known?.length ?? 0) < 0) fail("Too many entity references");
      return known ?? fail(`Entity '${name}' not defined`);
    });
  const { doc } = root;
  const isDocument = root.type === DOCUMENT;
  const open: N[] = [];
  let parent = root;
  const scopeOfRegistry = () => (parent === root && context !== null && context.doc === doc ? context : parent);
  source = source.replace(/\r\n?/g, "\n");
  for (let at = source.charCodeAt(0) === 0xfeff ? 1 : 0; at < source.length; at = xmlToken.lastIndex) {
    xmlToken.lastIndex = at;
    const match = xmlToken.exec(source) ?? fail("Not well-formed at offset " + at);
    let resume = xmlToken.lastIndex;
    const [, comment, cdata, target, instruction, doctype, ids, end, start, attributes, selfClosing, text] = match;
    let closed: N | null = null;
    const append = (node: N) => core.insert(node, isHtml(parent, "template") ? parent.x : parent, null);
    if (text !== undefined) {
      const reference =
        entities.size > 0 && open.length > 0
          ? text.matchAll(entityReference).find(it => entities.$get(it[1])?.includes("<"))
          : undefined;
      if (reference !== undefined) {
        if (++expansions > 1000 || (room -= entities.$get(reference[1])!.length) < 0)
          fail("Too many entity references");
        source =
          source.slice(0, at + reference.index) +
          entities.$get(reference[1]) +
          source.slice(at + reference.index + reference[0].length);
        resume = at;
      } else if (open.length > 0 || !isDocument) append(core.createText(doc, decodeXml(text)));
      else if (text.trim() !== "") fail("Text outside of the root element");
    } else if (start !== undefined) {
      if (isDocument && open.length === 0 && core.documentElement(doc) !== null) fail("Extra content at the end");
      const attrs = Array.from(attributes.matchAll(xmlAttribute), it => [
        it[1],
        decodeXml((it[2] ?? it[3]).replace(/[\t\n]/g, " ")),
      ]);
      const resolve = (prefix: string | null) => {
        const own = attrs.find(it => it[0] === (prefix === null ? "xmlns" : "xmlns:" + prefix));
        if (own !== undefined) return own[1] || null;
        if (prefix === "xml") return XML_NS;
        const scope = open.length > 0 ? parent : context;
        const found = scope && locateNamespace(scope, prefix);
        return found ?? (prefix === null ? null : fail(`Namespace prefix ${prefix} is not defined`));
      };
      if (!xmlName.test(start)) fail(`The name ${start} is not valid`);
      const colon = start.indexOf(":");
      const prefix = colon < 0 ? null : start.slice(0, colon);
      const is = attrs.find(it => it[0] === "is")?.[1] ?? null;
      if (loader !== null) hooks.beforeConstructing(parent, start.slice(colon + 1), is);
      if (attrs.some(it => it[0] === "customelementregistry")) core.setRegistry(core.noteScopedRegistry(), doc);
      else if (core.hasScopedRegistries() && !isHtml(parent, "template"))
        core.setRegistry(core.registryOf(scopeOfRegistry()), doc);
      const node = core.createElementNS(
        (isHtml(parent, "template") ? parent.x : parent).doc,
        resolve(prefix),
        prefix,
        start.slice(colon + 1),
        is,
        loader !== null,
      );
      core.setRegistry(undefined);
      if (node.name === "script" && node.x !== null) {
        node.x.started = loader === null;
        node.x.parserDoc = doc;
        node.x.forceAsync = !(node.x.parserInserted = loader !== null);
      }
      for (const [name, value] of attrs) {
        const space = name.includes(":") ? name.slice(0, name.indexOf(":")) : null;
        const local = name.slice(name.indexOf(":") + 1);
        const uri = name === "xmlns" || space === "xmlns" ? XMLNS_NS : space === null ? null : resolve(space);
        if (!xmlName.test(name) || core.findAttrNS(node, uri, local) !== null)
          fail(`Attribute ${name} is not valid or redefined`);
        if (
          space === "xmlns" &&
          (local === "xmlns" || value === "" || (local === "xml") !== (value === XML_NS) || value === XMLNS_NS)
        ) {
          fail(`The declaration ${name} is not valid`);
        }
        core.setAttrNS(node, name, value, uri);
      }
      if (loader !== null) loader.isInserting = true;
      append(node);
      if (loader !== null) {
        loader.isInserting = false;
        core.react();
      }
      if (selfClosing) closed = node;
      else if (open.push((parent = node)) > MAX_XML_DEPTH) fail("Excessive depth in document");
    } else if (end !== undefined) {
      closed = parent;
      if (open.length === 0 || core.qualifiedName(open.pop()!) !== end) fail("Opening and ending tag mismatch: " + end);
      parent = open[open.length - 1] ?? root;
    } else if (comment !== undefined) append(core.createData(doc, COMMENT, comment));
    else if (cdata !== undefined) append(core.createData(doc, CDATA, cdata));
    else if (target !== undefined) {
      if (target !== "xml") append(core.createData(doc, INSTRUCTION, instruction, target));
    } else {
      const quoted = Array.from(ids.split("[")[0].matchAll(/"([^"]*)"|'([^']*)'/g), it => it[1] ?? it[2]);
      if (!/^\s*PUBLIC/.test(ids)) quoted.unshift("");
      for (const it of ids.matchAll(/<!ENTITY\s+(\S+)\s+(?:"([^"]*)"|'([^']*)')/g))
        entities.$set(it[1], it[2] ?? it[3]);
      append(core.createDoctype(doc, doctype, quoted[0] ?? "", quoted[1] ?? ""));
      hasHtmlEntities = /XHTML|MathML/.test(quoted[0] ?? "");
    }
    if (closed !== null && loader !== null) {
      closed.kind.parsed?.(closed);
      if (closed.name === "script" && closed.x !== null) {
        loader.onScript!(closed);
        yield;
      }
    }
    xmlToken.lastIndex = resume;
  }
  if (open.length > 0) fail("Premature end of data in tag " + parent.name);
  if (isDocument && core.documentElement(doc) === null) fail("Document is empty");
}

function parseXmlDocument(doc: Doc, source: string) {
  try {
    parseXml(source, doc.node, null);
    return true;
  } catch (error) {
    reportXmlError(doc, error as Error);
    return false;
  }
}

function reportXmlError(doc: Doc, error: Error) {
  const report = core.createPlainElement(doc, "parsererror", HTML);
  core.insert(core.createText(doc, error.message), report, null);
  let root = core.documentElement(doc);
  if (root === null) {
    core.insert(core.createPlainElement(doc, "html", HTML), doc.node, null);
    core.insert((root = core.createPlainElement(doc, "body", HTML)), core.documentElement(doc)!, null);
  }
  core.insert(report, root, root.first);
}

// ───────────────────────────── serialization ─────────────────────────────

const escapes = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\xa0": "&nbsp;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};
const escapeOne = (character: string) => escapes[character];
const inText = /[&<>\xa0]/g;
const inAttribute = /[&<>"\xa0]/g;

type Options = { serializableShadowRoots?: boolean; shadowRoots?: any[] };

function serializedName(key: string): string {
  const namespace = core.attrNamespace(key);
  if (namespace === null) return key;
  const local = core.attrLocalName(key);
  if (namespace === XMLNS_NS) return local === "xmlns" ? local : "xmlns:" + local;
  return namespace === XML_NS ? "xml:" + local : namespace === XLINK_NS ? "xlink:" + local : core.attrName(key);
}

const tagNameOf = (node: N) => (node.ns === core.OTHER ? core.qualifiedName(node) : node.name);

function startTag(node: N): string {
  let html = "<" + tagNameOf(node);
  if (node.rare?.is && !core.hasAttr(node, "is")) html += ` is="${node.rare.is.replace(inAttribute, escapeOne)}"`;
  if (node.flags & flags.STYLE_DIRTY) hooks.flushStyle(node);
  const attrs = node.attrs;
  if (attrs !== null) {
    for (let i = 0; i < attrs.length; i += 2)
      html += ` ${serializedName(attrs[i])}="${attrs[i + 1].replace(inAttribute, escapeOne)}"`;
  }
  return html + ">";
}

function serializeShadow(host: N, options: Options): string {
  const root = host.rare!.shadow;
  const { mode, delegatesFocus, serializable, clonable } = core.scopeOf(root!);
  if (!(serializable && options.serializableShadowRoots) && !options.shadowRoots?.includes(root!.js)) return "";
  const flag = (on: boolean, name: string) => (on ? ` shadowroot${name}=""` : "");
  const { manualSlots, referenceTarget } = core.scopeOf(root!);
  let rest = flag(delegatesFocus, "delegatesfocus") + flag(serializable, "serializable");
  if (manualSlots) rest += ' shadowrootslotassignment="manual"';
  rest += flag(clonable, "clonable");
  if (referenceTarget !== null)
    rest += ` shadowrootreferencetarget="${referenceTarget.replace(inAttribute, escapeOne)}"`;
  rest += flag(
    core.registryOf(root!) !== host.doc.registry ||
      (host.doc.registry === null && core.registryOf(host.doc.node) !== null),
    "customelementregistry",
  );
  return `<template shadowrootmode="${mode}"${rest}>${htmlOfChildren(root!, options)}</template>`;
}

function htmlOf(node: N, options?: Options): string {
  switch (node.type) {
    case ELEMENT:
      if (node.ns === HTML && voids.$has(node.name)) return startTag(node);
      return startTag(node) + htmlOfChildren(node, options) + "</" + tagNameOf(node) + ">";
    case COMMENT:
      return "<!--" + node.data + "-->";
    case INSTRUCTION:
      return "<?" + node.name + " " + node.data + "?>";
    case DOCTYPE:
      return "<!DOCTYPE " + node.name + ">";
  }
  const parent = node.parent;
  const isRaw =
    parent !== null &&
    parent.ns === HTML &&
    (rawText.$has(parent.name) || (parent.name === "noscript" && node.doc.page !== null));
  return isRaw ? node.data : node.data.replace(inText, escapeOne);
}

function htmlOfChildren(node: N, options?: Options): string {
  if (node.ns === HTML && voids.$has(node.name) && node.type === ELEMENT) return "";
  let html = options !== undefined && node.flags & flags.HOST ? serializeShadow(node, options) : "";
  for (let child = (isHtml(node, "template") ? node.x : node).first; child !== null; child = child.next) {
    html += htmlOf(child, options);
  }
  return html;
}

/** https://w3c.github.io/DOM-Parsing/#dfn-xml-serialization */
class XmlWriter {
  isStrict: boolean;
  nextPrefix = 1;

  constructor(isStrict: boolean) {
    this.isStrict = isStrict;
  }

  check(isWrong: boolean) {
    if (isWrong && this.isStrict)
      throw core.domError("InvalidStateError", "The node cannot be serialized as well-formed XML.");
  }

  quote(value: string | null) {
    this.check(notXmlCharacter.test(value ?? ""));
    return '="' + (value ?? "").replace(/[&<>"\t\n\r]/g, escapeOne) + '"';
  }

  children(node: N, inherited: string | null, prefixes: Prefixes): string {
    let xml = "";
    for (let child = (isHtml(node, "template") ? node.x : node).first; child !== null; child = child.next) {
      xml += this.node(child, inherited, prefixes);
    }
    return xml;
  }

  node(node: N, inherited: string | null, prefixes: Prefixes): string {
    const { data } = node;
    if (core.isData(node)) this.check(notXmlCharacter.test(data));
    switch (node.type) {
      case ELEMENT:
        return this.element(node, inherited, prefixes);
      case TEXT:
        return data.replace(/[&<>]/g, escapeOne);
      case CDATA:
        return "<![CDATA[" + data + "]]>";
      case COMMENT:
        this.check(data.includes("--") || data.endsWith("-"));
        return "<!--" + data + "-->";
      case INSTRUCTION:
        this.check(node.name.includes(":") || asciiLower(node.name) === "xml" || data.includes("?>"));
        return "<?" + node.name + " " + data + "?>";
      case DOCTYPE: {
        const { publicId, systemId } = node.x;
        const ids =
          (publicId ? ` PUBLIC "${publicId}"` : systemId ? " SYSTEM" : "") + (systemId ? ` "${systemId}"` : "");
        return "<!DOCTYPE " + node.name + ids + ">";
      }
      case core.ATTRIBUTE:
        return this.quote(hooks.attrValue(node)).slice(2, -1);
    }
    return this.children(node, inherited, prefixes);
  }

  element(node: N, inherited: string | null, outer: Prefixes): string {
    const prefixes = new Map(outer);
    const declared = new Map<string, string>();
    const prefixFor = (namespace: string | null, preferred: string | null) => {
      if (preferred !== null && prefixes.$get(preferred) === namespace) return preferred;
      return Array.from(prefixes).findLast(it => it[1] === namespace)?.[0] ?? null;
    };
    const bind = (prefix: string, namespace: string) => {
      prefixes.$delete(prefix);
      prefixes.$set(prefix, namespace);
    };
    const generate = (namespace: string) => {
      let prefix;
      do prefix = "ns" + this.nextPrefix++;
      while (declared.$has(prefix));
      bind(prefix, namespace);
      return prefix;
    };
    if (node.flags & flags.STYLE_DIRTY) hooks.flushStyle(node);
    const attrs: string[] = node.attrs ?? [];
    let localDefault: string | null = null;
    for (let i = 0; i < attrs.length; i += 2) {
      const name = core.attrName(attrs[i]);
      if (core.attrNamespace(attrs[i]) !== XMLNS_NS && name !== "xmlns") continue;
      if (name === "xmlns") localDefault = attrs[i + 1];
      else if (attrs[i + 1] !== XML_NS && prefixes.$get(name.slice(6)) !== attrs[i + 1]) {
        bind(name.slice(6), attrs[i + 1]);
        declared.$set(name.slice(6), attrs[i + 1]);
      }
    }
    const namespace = core.namespaceOf(node);
    let prefix = core.prefixOf(node);
    let name = node.name;
    let declaration = "";
    let ignoresDefault = false;
    this.check(name.includes(":") || !xmlName.test(name) || prefix === "xmlns");
    if (inherited === namespace) {
      ignoresDefault = localDefault !== null;
      if (namespace === XML_NS) name = "xml:" + name;
    } else {
      const candidate =
        prefix === "xmlns"
          ? prefix
          : prefix === null && namespace === localDefault
            ? null
            : prefixFor(namespace, prefix);
      if (candidate !== null || prefix !== null) {
        if (candidate === null) {
          if (declared.$has(prefix!)) prefix = generate(namespace!);
          else bind(prefix!, namespace!);
          declaration = " xmlns:" + prefix + this.quote(namespace);
        }
        name = (candidate ?? prefix) + ":" + name;
        if (localDefault !== null && localDefault !== XML_NS) inherited = localDefault || null;
      } else {
        ignoresDefault = localDefault !== namespace;
        if (ignoresDefault) declaration = " xmlns" + this.quote(namespace);
        inherited = namespace;
      }
    }
    let xml = "<" + name + declaration;
    for (let i = 0; i < attrs.length; i += 2) {
      const [space, local, qualified] = [
        core.attrNamespace(attrs[i]),
        core.attrLocalName(attrs[i]),
        core.attrName(attrs[i]),
      ];
      let own: string | null = null;
      if (qualified === "xmlns") {
        if (ignoresDefault || attrs[i + 1] === XML_NS) continue;
      } else if (space === XMLNS_NS) {
        if (attrs[i + 1] === XML_NS || declared.$get(local) !== attrs[i + 1]) continue;
        own = "xmlns";
      } else if (space !== null) {
        const given = local === qualified ? null : qualified.slice(0, qualified.indexOf(":"));
        own = prefixFor(space, given);
        if (own === null) {
          if (given !== null && !prefixes.$has(given)) bind((own = given), space);
          else own = generate(space);
          xml += " xmlns:" + own + this.quote(space);
        }
      }
      this.check(local.includes(":") || !xmlName.test(local) || (local === "xmlns" && space === null));
      xml += " " + (own === null ? "" : own + ":") + local + this.quote(attrs[i + 1]);
    }
    if (node.ns === HTML && voids.$has(node.name) && node.first === null) return xml + " />";
    if (node.ns !== HTML && node.first === null) return xml + "/>";
    return xml + ">" + this.children(node, inherited, prefixes) + "</" + name + ">";
  }
}

/** Namespaces by their prefixes, the latest last. */
type Prefixes = Map<string, string>;
const notXmlCharacter = /[^\t\n\r\x20-퟿-�\u{10000}-\u{10ffff}]/u;
const initialPrefixes = (): Prefixes => new Map([["xml", XML_NS]]);
const serializeXml = (node: N, isStrict = false) => new XmlWriter(isStrict).node(node, null, initialPrefixes());

hooks.parseFragment = parseFragment;
hooks.parseHtmlFragment = parseHtmlFragment;
hooks.serializeInner = (node: N, options?: Options) =>
  node.doc.isHtml ? htmlOfChildren(node, options) : new XmlWriter(true).children(node, null, initialPrefixes());
hooks.serializeOuter = (node: N) => (node.doc.isHtml ? htmlOf(node) : serializeXml(node, true));

const parseInert = (context: N, html: string) => parseHtmlFragment(context, html, true, false, context, true);

export default { Parser, parseDocument, parseInert, parseXmlDocument, serializeXml, voids };
