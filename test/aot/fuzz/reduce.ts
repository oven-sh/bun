// Makes a program small while it keeps failing in the same way: delta debugging on lines, on blocks (a block goes, or only its head
// and its closing brace go), on bracketed groups and on tokens.
//
// Candidates are tested many at a time, because one build of the product can hold many programs: `fails` answers for a list. Those
// of a list that still fail are then applied together if that fails too, else as many of them as do.
import { tokenize } from "./tokens";

export interface Reduction {
  text: string;
  /** Candidates tested, and calls of `fails`. */
  tests: number;
  rounds: number;
}

export interface ReduceOptions {
  parses(candidate: string): boolean;
  fails(candidates: string[]): Promise<boolean[]>;
  /** How many candidates one call of `fails` takes. */
  width: number;
  seconds: number;
}

// The text is cut into pieces; an edit blanks some and may rewrite one.
interface Edit {
  blank: number[];
  put?: { at: number; text: string };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

function applied(pieces: string[], edits: Edit[]): string[] {
  const next = [...pieces];
  for (const edit of edits) {
    for (const index of edit.blank) next[index] = "";
    if (edit.put) next[edit.put.at] = edit.put.text;
  }
  return next;
}

const lines = (text: string) => text.split(/(?<=\n)/);

function tokenPieces(text: string): string[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [text];
  return [text.slice(0, tokens[0].start), ...tokens.map((token, index) => text.slice(token.start, tokens[index + 1]?.start ?? text.length))];
}

function chunks(count: number, size: number): Edit[] {
  const edits: Edit[] = [];
  for (let end = count; end > 0; end -= size) edits.push({ blank: range(Math.max(0, end - size), end) });
  return edits;
}

function blocks(pieces: string[]): Edit[] {
  const edits: Edit[] = [];
  pieces.forEach((line, at) => {
    if (!/[{(\[]\s*$/.test(line)) return;
    let depth = 0;
    for (let end = at; end < pieces.length; end++) {
      for (const token of tokenize(pieces[end])) {
        if (token.kind !== "punctuator") continue;
        if ("{([".includes(token.text)) depth++;
        else if ("})]".includes(token.text)) depth--;
      }
      if (depth > 0) continue;
      if (end > at) edits.push({ blank: range(at, end + 1) }, { blank: [at, end] });
      return;
    }
  });
  return edits;
}

// `f(() => x)` becomes `f()`, `x` or `0`.
function groups(pieces: string[]): Edit[] {
  const edits: Edit[] = [];
  const open: number[] = [];
  pieces.forEach((piece, at) => {
    const text = piece.trim();
    if (text === "(" || text === "[" || text === "{") open.push(at);
    else if (text === ")" || text === "]" || text === "}") {
      const from = open.pop();
      if (from === undefined) return;
      if (at > from + 1) edits.push({ blank: range(from + 1, at) }, { blank: range(from + 1, at + 1), put: { at: from, text: "0 " } });
      edits.push({ blank: [from, at] });
    }
  });
  return edits.sort((a, b) => b.blank.length - a.blank.length);
}

export async function reduce(text: string, { parses, fails, width, seconds }: ReduceOptions): Promise<Reduction> {
  const deadline = Date.now() + seconds * 1000;
  const tried = new Set<string>();
  let tests = 0;
  let rounds = 0;

  const test = async (candidates: string[]) => {
    tests += candidates.length;
    rounds++;
    return fails(candidates);
  };

  // Tries the edits on the pieces and returns the pieces with all that could be applied.
  const attempt = async (pieces: string[], edits: Edit[]): Promise<string[]> => {
    for (let at = 0; at < edits.length && Date.now() < deadline; ) {
      const group: { edit: Edit; text: string }[] = [];
      const size = pieces.join("").length;
      for (; at < edits.length && group.length < width; at++) {
        const edit = edits[at];
        if (!edit.blank.some(index => pieces[index] !== "")) continue;
        const candidate = applied(pieces, [edit]).join("");
        if (candidate.length >= size || tried.has(candidate) || !parses(candidate)) continue;
        tried.add(candidate);
        group.push({ edit, text: candidate });
      }
      if (!group.length) continue;
      const results = await test(group.map(each => each.text));
      const good = group.filter((_, index) => results[index]).map(each => each.edit);
      if (!good.length) continue;
      if (good.length === 1) {
        pieces = applied(pieces, good);
        continue;
      }
      // All of them at once, or the longest run of them from the first on: one more call answers for every length.
      const prefixes = good.map((_, index) => applied(pieces, good.slice(0, good.length - index)));
      const usable = prefixes.map(each => each.join("")).map(candidate => parses(candidate));
      const wanted = prefixes.filter((_, index) => usable[index]).slice(0, width);
      const answers = await test(wanted.map(each => each.join("")));
      pieces = wanted[answers.indexOf(true)] ?? applied(pieces, [good[0]]);
    }
    return pieces;
  };

  const pass = async (cut: (text: string) => string[], edits: (pieces: string[]) => Edit[]) => {
    const before = text.length;
    text = (await attempt(cut(text), edits(cut(text)))).join("");
    return text.length < before;
  };

  const bySize = async (cut: (text: string) => string[], largest: number) => {
    for (let size = Math.min(largest, Math.max(1, cut(text).length >> 1)); size >= 1 && Date.now() < deadline; ) {
      const progress = await pass(cut, pieces => chunks(pieces.length, size));
      if (!(progress && size === 1)) size = size === 1 ? 0 : size >> 1;
    }
  };

  for (let round = 0; round < 8 && Date.now() < deadline; round++) {
    const before = text.length;
    await bySize(lines, Infinity);
    text = text.replace(/\n\s*\n/g, "\n");
    await pass(lines, blocks);
    if (text.length < 6000) {
      await pass(tokenPieces, groups);
      await bySize(tokenPieces, 8);
    }
    if (text.length === before) break;
  }
  return { text: text.replace(/\n\s*\n/g, "\n").trim() + "\n", tests, rounds };
}

/** The shape of a program: names numbered in order of appearance, literals by kind. Two programs of one shape are one finding. */
export function shape(text: string): string {
  const names = new Map<string, string>();
  return tokenize(text)
    .map(token => {
      if (token.kind === "number") return "0";
      if (token.kind === "string" || token.kind === "template") return '""';
      if (token.kind !== "name") return token.text;
      if (/^(await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|function|if|in|instanceof|let|new|return|static|super|switch|this|throw|try|typeof|var|void|while|yield|async|of|get|set|null|true|false|undefined|Object|Array|Reflect|Proxy|Symbol|Map|Set|JSON|Math|Promise|String|Number|Error|print|console|log)$/.test(token.text)) return token.text; // prettier-ignore
      if (!names.has(token.text)) names.set(token.text, "n" + names.size);
      return names.get(token.text)!;
    })
    .join(" ");
}
