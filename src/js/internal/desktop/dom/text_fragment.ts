// https://wicg.github.io/scroll-to-text-fragment/
const core = require("internal/desktop/dom/core");
const html = require("internal/desktop/dom/html");
const focusing = require("internal/desktop/dom/focus");
const interactive = require("internal/desktop/dom/interactive");

type N = $Dom.N;
type Page = $Dom.Page;
type Directive = { prefix: string | null; start: string; end: string | null; suffix: string | null };

const RENDERED = 1;
const IS_VISIBLE = 2;
const CONTENTS = 64;
const BLOCK = 2048;
const HIDDEN_CONTENT = 16384;
const BOUNDARY = "\n";
const isOpaque = /^(?:audio|iframe|img|meter|object|progress|script|select|style|textarea|input|video)$/;
const marks = /\p{M}/gu;
const spaces = /\s+/g;

const fold = (text: string) => text.normalize("NFD").replace(marks, "").toLowerCase();

function decode(text: string): string {
  const bytes = text.replace(/%([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return fold(Buffer.from(bytes, "latin1").toString()).replace(spaces, " ");
}

function parse(source: string): Directive | null {
  const parts = source.split(",");
  const prefix = parts[0].endsWith("-") ? parts.shift()!.slice(0, -1) : null;
  const suffix = parts.at(-1)?.startsWith("-") ? parts.pop()!.slice(1) : null;
  const [start, end = null] = parts;
  const terms = [prefix, start, end, suffix];
  if (parts.length < 1 || parts.length > 2 || terms.some(it => it === "" || it?.includes("-"))) return null;
  return {
    prefix: prefix && decode(prefix),
    start: decode(start),
    end: end && decode(end),
    suffix: suffix && decode(suffix),
  };
}

/** The text of a document as it is compared, and where each of its code units comes from. */
class Text {
  value = "";
  nodes: N[] = [];
  offsets: number[] = [];
  boundaries = new Set<number>();

  constructor(page: Page) {
    const engine = core.sync(page.doc);
    const units: string[] = [];
    const add = (text: string, node: N, offset: number) => {
      for (let i = 0; i < text.length; i++) {
        units.push(text[i]);
        this.nodes.push(node);
        this.offsets.push(offset);
      }
    };
    const canBeRevealed = (node: N) =>
      node.rare?.pseudo === "details-content" || core.asciiLower(core.getAttr(node, "hidden") ?? "") === "until-found";
    const visit = (parent: N, isRevealed: boolean) => {
      for (const node of core.flatChildren(parent)) {
        let bits = html.styleBits(node);
        if (bits & HIDDEN_CONTENT) {
          if (!isRevealed) continue;
          const display = node.type === core.ELEMENT ? engine.computedStyle(node.id, "", "display") : "inline";
          bits =
            display === "none"
              ? 0
              : RENDERED | IS_VISIBLE | (display.startsWith("inline") || display === "contents" ? 0 : BLOCK);
        }
        const { type } = node;
        if (type !== core.ELEMENT) {
          if (type !== core.TEXT || (bits & (RENDERED | IS_VISIBLE)) !== (RENDERED | IS_VISIBLE)) continue;
          let offset = 0;
          for (const character of node.data) {
            if (character.trim() !== "") add(fold(character), node, offset);
            else if (units.at(-1) !== " " && units.at(-1) !== BOUNDARY) add(" ", node, offset);
            offset += character.length;
          }
        } else {
          const { name } = node;
          if (bits & (RENDERED | CONTENTS) && !(node.ns === core.HTML && isOpaque.test(name))) {
            if (bits & BLOCK) add(BOUNDARY, node, 0);
            else if (name === "br" && units.at(-1) !== " ") add(" ", node, 0);
            visit(node, isRevealed || canBeRevealed(node));
            if (bits & BLOCK) add(BOUNDARY, node, 0);
          }
        }
      }
    };
    visit(page.doc.node, false);
    this.value = units.join("");
    for (const { index } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(this.value))
      this.boundaries.$add(index);
    this.boundaries.$add(this.value.length);
  }

  indexOf(term: string, from: number, startsWord: boolean, endsWord: boolean): number {
    let at = this.value.indexOf(term, from);
    const fits = () =>
      (!startsWord || this.boundaries.$has(at)) && (!endsWord || this.boundaries.$has(at + term.length));
    while (at >= 0 && !fits()) at = this.value.indexOf(term, at + 1);
    return at;
  }

  skipSpaces(at: number): number {
    while (this.value[at] === " " || this.value[at] === BOUNDARY) at++;
    return at;
  }

  /** https://wicg.github.io/scroll-to-text-fragment/#find-a-range-from-a-text-directive */
  find({ prefix, start, end, suffix }: Directive): [number, number] | null {
    const endsWord = end !== null || suffix === null;
    for (let from = 0; from < this.value.length;) {
      let first: number;
      if (prefix !== null) {
        const before = this.indexOf(prefix, from, true, false);
        if (before < 0) return null;
        from = before + 1;
        first = this.skipSpaces(before + prefix.length);
        if (!this.value.startsWith(start, first) || (endsWord && !this.boundaries.$has(first + start.length))) continue;
      } else {
        if ((first = this.indexOf(start, from, true, endsWord)) < 0) return null;
        from = first + 1;
      }
      for (let last = first + start.length; ;) {
        if (end !== null) {
          if ((last = this.indexOf(end, last, true, suffix === null)) < 0) return null;
          last += end.length;
        }
        if (suffix === null) return [first, last];
        const after = this.skipSpaces(last);
        if (this.value.startsWith(suffix, after) && this.boundaries.$has(after + suffix.length)) return [first, last];
        if (end === null) break;
      }
    }
    return null;
  }
}

/** Whether something was found. */
function show(page: Page, directives: string, scrolls: boolean): boolean {
  const parsed = directives.split("&").flatMap(it => (it.startsWith("text=") && parse(it.slice(5))) || []);
  const text = parsed.length === 0 ? null : new Text(page);
  const found = parsed.map(it => text!.find(it)).filter(it => it !== null);
  const ranges = found.map(([first, last]) => {
    const [endNode, endOffset] = [text!.nodes[last - 1], text!.offsets[last - 1]];
    const length = endNode.data.codePointAt(endOffset)! > 0xffff ? 2 : 1;
    return [text!.nodes[first], text!.offsets[first], endNode, endOffset + length] as const;
  });
  const { doc } = page;
  doc.engine.setHighlight(
    "::target-text",
    0x7fffffff,
    ranges.flatMap(it => [it[0].id, it[1], it[2].id, it[3]]),
  );
  core.invalidate(doc);
  if (ranges.length === 0) return false;
  const [startNode, startOffset, endNode] = ranges[0];
  let target: N = startNode;
  while (target.type !== core.ELEMENT || !core.containsFlat(target, endNode)) target = core.flatParent(target)!;
  page.setTarget(target);
  focusing.startTabbingAt(page, startNode);
  interactive.reveal(startNode.parent!);
  if (!scrolls || !(startNode.flags & core.flags.CONNECTED)) return true;
  const engine = core.sync(doc);
  engine.revealPoint(startNode.id, startOffset, false);
  const [, top, , height] = engine.rangeRects(startNode.id, startOffset, startNode.id, startOffset + 1);
  html.scroll(doc, 1, undefined, top + height / 2 - page.height / 2, true, 1);
  return true;
}

export default { show };
