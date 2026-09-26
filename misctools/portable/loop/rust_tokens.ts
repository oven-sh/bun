// The tokens of a Rust source file, with where each one is in the text. For tools that rewrite a few
// places of a file and leave the rest, comments and layout included, as it is.

export type Token = {
  kind: "ident" | "punct" | "literal" | "lifetime" | "open" | "close";
  text: string;
  start: number;
  end: number;
  /** For a bracket: the index of the token that closes or opens it. */
  partner: number;
};

const closes: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

export function tokens(text: string): Token[] {
  const out: Token[] = [];
  const open: number[] = [];
  const n = text.length;
  let i = 0;
  const isWordStart = (c: string) => /[A-Za-z_]/.test(c) || c > "\x7f";
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c) || c > "\x7f";
  const push = (kind: Token["kind"], start: number, end: number) =>
    out.push({ kind, text: text.slice(start, end), start, end, partner: -1 });
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") (depth++, (i += 2));
        else if (text[i] === "*" && text[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      continue;
    }
    // Raw strings and raw identifiers, byte and C strings.
    const prefixed = /^(?:b|c|br|cr|r)(#*)"/.exec(text.slice(i, i + 70));
    if (prefixed && /r/.test(prefixed[0].slice(0, prefixed[0].indexOf('"')).replace(/#/g, ""))) {
      const start = i;
      const close = '"' + prefixed[1];
      const from = i + prefixed[0].length;
      const end = text.indexOf(close, from);
      i = end < 0 ? n : end + close.length;
      push("literal", start, i);
      continue;
    }
    if (c === '"' || ((c === "b" || c === "c") && text[i + 1] === '"')) {
      const start = i;
      i += c === '"' ? 1 : 2;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      push("literal", start, i);
      continue;
    }
    if (c === "'" || (c === "b" && text[i + 1] === "'")) {
      const start = i;
      const at = c === "b" ? i + 1 : i;
      const character = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]+\}|.)|[^\\'])'/.exec(text.slice(at, at + 16));
      if (character) {
        i = at + character[0].length;
        push("literal", start, i);
      } else {
        i = at + 1;
        while (i < n && isWord(text[i])) i++;
        push("lifetime", start, i);
      }
      continue;
    }
    if (c === "r" && text[i + 1] === "#" && isWordStart(text[i + 2] ?? "")) {
      const start = i;
      i += 2;
      while (i < n && isWord(text[i])) i++;
      push("ident", start, i);
      continue;
    }
    if (isWordStart(c)) {
      const start = i;
      while (i < n && isWord(text[i])) i++;
      push("ident", start, i);
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && (isWord(text[i]) || (text[i] === "." && /[0-9]/.test(text[i + 1] ?? "") && text[i - 1] !== ".")))
        i++;
      push("literal", start, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      open.push(out.length);
      push("open", i, i + 1);
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      const partner = open.pop();
      push("close", i, i + 1);
      if (partner !== undefined && closes[out[partner].text] === c) {
        out[partner].partner = out.length - 1;
        out[out.length - 1].partner = partner;
      }
      i++;
      continue;
    }
    push("punct", i, i + 1);
    i++;
  }
  return out;
}

/** Replacements of ranges of a text, applied from the end so that the positions hold. */
export class Edits {
  private list: { start: number; end: number; text: string }[] = [];
  replace(start: number, end: number, text: string) {
    this.list.push({ start, end, text });
  }
  insert(at: number, text: string) {
    this.list.push({ start: at, end: at, text });
  }
  get count() {
    return this.list.length;
  }
  apply(source: string) {
    const sorted = [...this.list]
      .map((edit, order) => ({ ...edit, order }))
      .sort((a, b) => b.start - a.start || b.end - a.end || b.order - a.order);
    let out = source;
    let limit = Infinity;
    for (const edit of sorted) {
      if (edit.end > limit) throw new Error(`two replacements of the same text at ${edit.start}`);
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
      limit = edit.start;
    }
    return out;
  }
}
