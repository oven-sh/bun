// Marks the words that the spell checker of the system does not know.
const core = require("internal/desktop/dom/core");
const editing = require("internal/desktop/dom/editing");
const { inherited, styleBits } = require("internal/desktop/dom/html");
const { textControl } = require("internal/desktop/dom/forms");
const { selectionOf } = require("internal/desktop/dom/range");

type N = $Dom.N;
type Page = $Dom.Page;
/** `words` has a start and an end for each. */
type Checked = { text: string; words: number[]; isCurrent: boolean };

const EDITABLE = 4;
const AFTER_WORD = 60;
const IN_WORD = 1000;
/** The first use keeps the UI busy for a moment. */
const BEFORE_FIRST_USE = 2000;
const MAX_NODES = 64;
const MAX_WORD_LENGTH = 8192;
const endsInWord = /[\p{L}\p{M}\p{N}'’]$/u;
let isInUse = false;

class Spelling {
  nodes = new Map<N, Checked>();
  timer: any = null;
}

function show(page: Page) {
  const points: number[] = [];
  page.spelling.nodes.$forEach(({ words }: Checked, { id }: N) => {
    for (let i = 0; i < words.length; i += 2) points.push(id, words[i], id, words[i + 1]);
  });
  page.doc.engine.setHighlight("::spelling-error", -3, points);
}

/** Keeps the words that an edit has not touched. */
function follow(checked: Checked, text: string) {
  const { text: old, words } = checked;
  const shorter = Math.min(old.length, text.length);
  let [head, tail] = [0, 0];
  while (head < shorter && old[head] === text[head]) head++;
  while (tail < shorter - head && old[old.length - 1 - tail] === text[text.length - 1 - tail]) tail++;
  const kept: number[] = [];
  for (let i = 0; i < words.length; i += 2) {
    if (words[i + 1] < head) kept.push(words[i], words[i + 1]);
    else {
      const { length } = old;
      if (words[i] > length - tail) kept.push(words[i] + text.length - length, words[i + 1] + text.length - length);
    }
  }
  checked.text = text;
  checked.words = kept;
  checked.isCurrent = false;
}

function beforeFrame(page: Page) {
  const nodes: Map<N, Checked> = page.spelling.nodes;
  let hasChanged = false;
  nodes.$forEach((checked, node) => {
    const isThere = node.flags & core.flags.CONNECTED && node.doc === page.doc;
    if (isThere && checked.text === node.data) return;
    hasChanged ||= checked.words.length > 0;
    if (isThere) follow(checked, node.data);
    else nodes.$delete(node);
  });
  if (hasChanged) show(page);
}

function caretOrTextChanged(page: Page) {
  const { enabled, text, end } = page.inputMethodState;
  clearTimeout(page.spelling.timer);
  if (!enabled) return;
  const delay = !isInUse
    ? BEFORE_FIRST_USE
    : endsInWord.test(text.slice(Math.max(end - 2, 0), end))
      ? IN_WORD
      : AFTER_WORD;
  page.spelling.timer = setTimeout(check, delay, page);
}

function check(page: Page) {
  const { doc } = page;
  const target = page.isDisposed || page.composition?.node ? null : editing.editTarget(doc);
  if (target === null || !page.host.checksSpelling()) return;
  const control = textControl(target);
  if (control !== null && !/^(?:textarea|text|search)$/.test(control.type)) return;
  if (!isInUse) page.native.request("spelling.check", "").then(ignore, ignore);
  isInUse = true;
  const nodes: Map<N, Checked> = page.spelling.nodes;
  let left = MAX_NODES;
  const visit = (node: N) => {
    if (left === 0) return;
    if (node.type === core.ELEMENT) {
      for (let child = node.first; child !== null; child = child.next) visit(child);
      return;
    }
    if (!core.isText(node) || node.id === 0 || node.data.length > MAX_WORD_LENGTH || node.data.trim() === "") return;
    if (control === null && !(styleBits(node.parent!) & EDITABLE)) return;
    if (!inherited(node.parent, "spellcheck", "true", "false", true)) return;
    left--;
    const text = node.data;
    let checked = nodes.$get(node);
    if (checked === undefined) nodes.$set(node, (checked = { text, words: [], isCurrent: false }));
    if (checked.isCurrent || checked.text !== text) return;
    checked.isCurrent = true;
    page.native.request("spelling.check", text).then((words: number[]) => {
      if (page.isDisposed || nodes.$get(node) !== checked || node.data !== text || `${words}` === `${checked.words}`)
        return;
      checked.words = Array.from(words);
      show(page);
      core.invalidate(doc);
    }, ignore);
  };
  visit(control?.editorText ?? target);
}

function ignore() {}

/** Selects the marked word where the selection starts. */
function selectMisspelling(page: Page): string {
  const selection = selectionOf(page.doc);
  const { r } = selection;
  const checked: Checked | undefined = r === null ? undefined : page.spelling.nodes.$get(r.startNode);
  if (r === null || checked === undefined || checked.text !== r.startNode.data || r.endNode !== r.startNode) return "";
  const { words, text } = checked;
  for (let i = 0; i < words.length; i += 2) {
    if (r.startOffset < words[i] || r.endOffset > words[i + 1]) continue;
    selection.select(r.startNode, words[i], r.startNode, words[i + 1]);
    return text.slice(words[i], words[i + 1]);
  }
  return "";
}

/** The dictionary has changed. */
function checkAgain(page: Page) {
  page.spelling.nodes.$forEach((checked: Checked) => void (checked.isCurrent = false));
  check(page);
}

export default { beforeFrame, caretOrTextChanged, checkAgain, selectMisspelling, Spelling };
