// Find in page.
const core = require("internal/desktop/dom/core");
const ranges = require("internal/desktop/dom/range");
const { styleBits } = require("internal/desktop/dom/html");

type N = $Dom.N;
type Page = $Dom.Page;
type Match = [startNode: N, startOffset: number, endNode: N, endOffset: number];

const searches = new WeakMap<Page, { matches: Match[]; active: number }>();

/** A match does not go from one block to another. */
function search(page: Page, text: string, matchCase: boolean): Match[] {
  const escaped = RegExp.escape(text).replaceAll("\\x20", "\\s+");
  const pattern = new RegExp(escaped, matchCase ? "gu" : "giu");
  const matches: Match[] = [];
  const modal = core.hooks.topModal(page.doc);
  let texts: N[] = [];
  const endBlock = () => {
    let index = 0;
    let start = 0;
    const locate = (offset: number, isEnd: boolean): [N, number] => {
      while (offset - start > texts[index].data.length - (isEnd ? 0 : 1)) start += texts[index++].data.length;
      return [texts[index], offset - start];
    };
    const joined = texts.map(node => node.data).join("");
    for (const match of joined.matchAll(pattern)) {
      matches.push([...locate(match.index, false), ...locate(match.index + match[0].length, true)]);
    }
    texts = [];
  };
  const visit = (parent: N) => {
    for (const node of core.flatChildren(parent)) {
      const bits = styleBits(node);
      if (node.type !== core.ELEMENT) {
        if ((bits & (3 | 16)) === 3 && (modal === null || core.containsFlat(modal, node))) texts.push(node);
      } else if (bits & (1 | 64) && node.rare?.pseudo !== "placeholder") {
        if (bits & 2048) endBlock();
        visit(node);
        if (bits & 2048) endBlock();
      }
    }
  };
  visit(page.doc.node);
  endBlock();
  return matches;
}

const toEngine = ([startNode, startOffset, endNode, endOffset]: Match) => [
  startNode.id,
  startOffset,
  endNode.id,
  endOffset,
];

function show(page: Page, matches: Match[], active: Match | undefined) {
  const { engine } = page.doc;
  engine.setHighlight("-internal-match", -2, matches.flatMap(toEngine));
  engine.setHighlight("-internal-active-match", -1, active ? toEngine(active) : []);
  core.invalidate(page.doc);
}

function find(page: Page, text: string, { forward = true, findNext = true, matchCase = false }: any = {}) {
  const matches = text === "" ? [] : search(page, text, matchCase);
  const previous = searches.get(page);
  const from = previous?.matches[previous.active];
  let active = 0;
  if (from?.[0].scope) {
    const order = (match: Match) => core.compareOrder(match[0], from[0]) || match[1] - from[1];
    active = forward
      ? Math.max(
          0,
          matches.findIndex(match => order(match) >= (findNext ? 0 : 1)),
        )
      : (matches.findLastIndex(match => order(match) <= (findNext ? 0 : -1)) + matches.length) % matches.length;
  }
  searches.set(page, { matches, active });
  show(page, matches, matches[active]);
  if (matches.length === 0) return { matches: 0, active: 0, rect: { x: 0, y: 0, width: 0, height: 0 } };
  const [startId, startOffset, endId, endOffset] = toEngine(matches[active]);
  page.doc.engine.revealPoint(startId, startOffset, false);
  const rect = page.doc.engine.rangeRects(startId, startOffset, endId, endOffset);
  const [x, y, width, height] = rect.map(it => Math.round(it * page.zoom));
  return { matches: matches.length, active: active + 1, rect: { x, y, width, height } };
}

function stop(page: Page, action = "clearSelection") {
  const last = searches.get(page);
  const active = last?.matches[last.active];
  searches.delete(page);
  show(page, [], undefined);
  if (action !== "clearSelection" && active?.[0].scope && active[2].scope)
    ranges.selectionOf(page.doc).select(...active);
}

/** `window.find` */
function select(page: Page, text: string, matchCase: boolean, isBackward: boolean, wraps: boolean): boolean {
  const matches = text === "" || page.container?.isInert() ? [] : search(page, text, matchCase);
  const selection = ranges.selectionOf(page.doc);
  const r = selection.span;
  const isBeyond = ([startNode, startOffset, endNode, endOffset]: Match) =>
    r === null ||
    (isBackward
      ? ranges.compareComposed(endNode, endOffset, r.startNode, r.startOffset) <= 0
      : ranges.compareComposed(startNode, startOffset, r.endNode, r.endOffset) >= 0);
  if (isBackward) matches.reverse();
  const found = matches.find(isBeyond) ?? (wraps ? matches[0] : undefined);
  if (found === undefined) return false;
  selection.select(...found);
  page.doc.engine.revealPoint(found[0].id, found[1], false);
  return true;
}

export default { find, select, stop };
