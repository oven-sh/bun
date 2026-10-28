// A tokenizer for JavaScript as Bun's transpiler prints it, and a rough model of its blocks and bindings: enough to know where a
// statement may be inserted and which names are in scope there. Whatever is built on it is parsed again before it is used, so a
// wrong guess costs a mutant and nothing else.

export interface Token {
  kind: "name" | "number" | "string" | "template" | "regexp" | "punctuator";
  text: string;
  start: number;
  end: number;
}

const punctuators = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**",
]; // prettier-ignore
const beforeExpression = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  const skipString = (from: number, quote: string) => {
    let i = from + 1;
    while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
    return i + 1;
  };
  const skipTemplate = (from: number): number => {
    let i = from + 1;
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "$" && source[i + 1] === "{") i = skipBraces(i + 1);
      else i++;
    }
    return i + 1;
  };
  const skipBraces = (from: number): number => {
    let i = from + 1;
    for (let depth = 1; i < source.length && depth > 0; ) {
      const c = source[i];
      if (c === "{") depth++, i++;
      else if (c === "}") depth--, i++;
      else if (c === '"' || c === "'") i = skipString(i, c);
      else if (c === "`") i = skipTemplate(i);
      else i++;
    }
    return i;
  };
  const regexpMayStart = () => {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.kind === "name") return beforeExpression.has(last.text);
    if (last.kind !== "punctuator") return false;
    return last.text !== ")" && last.text !== "]" && last.text !== "}" && last.text !== "++" && last.text !== "--";
  };

  while (at < source.length) {
    const c = source[at];
    if (c === " " || c === "\n" || c === "\t" || c === "\r") {
      at++;
      continue;
    }
    if (c === "/" && source[at + 1] === "/") {
      while (at < source.length && source[at] !== "\n") at++;
      continue;
    }
    if (c === "/" && source[at + 1] === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    const start = at;
    let kind: Token["kind"] = "punctuator";
    if (c === '"' || c === "'") (kind = "string"), (at = skipString(at, c));
    else if (c === "`") (kind = "template"), (at = skipTemplate(at));
    else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[at + 1] ?? ""))) {
      kind = "number";
      const found = /^(0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|[0-9][0-9_]*n|(?:[0-9][0-9_]*)?\.?[0-9_]*(?:[eE][-+]?[0-9]+)?)/.exec(source.slice(at, at + 80))!;
      at += Math.max(1, found[0].length);
    } else if (/[A-Za-z_$#\u0080-￿]/.test(c)) {
      kind = "name";
      while (at < source.length && /[\w$#\u0080-￿]/.test(source[at])) at++;
    } else if (c === "/" && regexpMayStart()) {
      kind = "regexp";
      at++;
      for (let inClass = false; at < source.length && (inClass || source[at] !== "/") && source[at] !== "\n"; at++) {
        if (source[at] === "\\") at++;
        else if (source[at] === "[") inClass = true;
        else if (source[at] === "]") inClass = false;
      }
      at++;
      while (at < source.length && /[a-z]/.test(source[at])) at++;
    } else at += punctuators.find(text => source.startsWith(text, at))?.length ?? 1;
    tokens.push({ kind, text: source.slice(start, at), start, end: at });
  }
  return tokens;
}

export type BindingKind = "object" | "array" | "instance" | "function" | "class" | "number" | "string" | "parameter" | "unknown";

export interface Binding {
  name: string;
  kind: BindingKind;
  constant: boolean;
  /** The class after `new`, for an instance. */
  of?: string;
}

/** A place between two statements. */
export interface Gap {
  /** Where in the source the text goes: the end of the line that ends the statement before it. */
  offset: number;
  indent: string;
  /** Innermost last. */
  bindings: Binding[];
  inFunction: boolean;
  inLoop: boolean;
  inConstructor: boolean;
  inMethod: boolean;
  inAsync: boolean;
  inGenerator: boolean;
}

interface Frame {
  kind: "block" | "object" | "class" | "switch" | "(" | "[";
  bindings: Binding[];
  head: string;
  function?: { constructor: boolean; method: boolean; async: boolean; generator: boolean };
  loop: boolean;
}

export interface Model {
  tokens: Token[];
  /** For the token that opens a pair, the index of the one that closes it, and the reverse. */
  partner: Int32Array;
  gaps: Gap[];
  /** Names after a dot and keys of literals and classes. */
  properties: string[];
  /** For each token, whether it lies where an expression is evaluated in a function or block (not in a class body or parameter list). */
  top: Binding[];
}

const keywords = new Set(
  "await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield async of get set null true false undefined".split(" "),
);
export const isKeyword = (text: string) => keywords.has(text);

function kindOfInitializer(tokens: Token[], at: number): Pick<Binding, "kind" | "of"> {
  const token = tokens[at];
  if (!token) return { kind: "unknown" };
  if (token.text === "{") return { kind: "object" };
  if (token.text === "[") return { kind: "array" };
  if (token.text === "new" && tokens[at + 1]?.kind === "name") return { kind: "instance", of: tokens[at + 1].text };
  if (token.text === "function" || token.text === "async") return { kind: "function" };
  if (token.text === "class") return { kind: "class" };
  const next = tokens[at + 1]?.text;
  if (token.kind === "number" && (next === ";" || next === ",")) return { kind: "number" };
  if ((token.kind === "string" || token.kind === "template") && (next === ";" || next === ",")) return { kind: "string" };
  if (token.kind === "name" && next === "=>") return { kind: "function" };
  return { kind: "unknown" };
}

export function model(source: string): Model {
  const tokens = tokenize(source);
  const partner = new Int32Array(tokens.length).fill(-1);
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "punctuator") return;
    if (token.text === "(" || token.text === "[" || token.text === "{") open.push(index);
    else if (token.text === ")" || token.text === "]" || token.text === "}") {
      const from = open.pop();
      if (from !== undefined) (partner[from] = index), (partner[index] = from);
    }
  });

  const top: Binding[] = [];
  const frames: Frame[] = [{ kind: "block", bindings: top, head: "", loop: false }];
  const gaps: Gap[] = [];
  const properties = new Set<string>();
  let pendingClass = false;
  let pendingParameters: Binding[] = [];

  const gapAfter = (index: number) => {
    const next = tokens[index + 1];
    if (next && /^(else|catch|finally|while|from|\)|,|\.|\?\.|\(|\[|`|=|as)$/.test(next.text)) return;
    const end = tokens[index].end;
    const newline = source.indexOf("\n", end);
    if (next && newline >= 0 && next.start < newline) return;
    const functions = frames.filter(frame => frame.function);
    const inner = functions[functions.length - 1]?.function;
    const lineStart = source.lastIndexOf("\n", tokens[index].start) + 1;
    const closes = tokens[index].text === "}";
    gaps.push({
      offset: newline < 0 ? source.length : newline,
      indent: /^[ \t]*/.exec(source.slice(closes ? lineStart : source.lastIndexOf("\n", statementStart(index)) + 1))![0],
      bindings: frames.flatMap(frame => frame.bindings),
      inFunction: !!inner,
      inLoop: frames.slice(frames.findLastIndex(frame => frame.function) + 1).some(frame => frame.loop),
      inConstructor: !!inner?.constructor,
      inMethod: !!inner?.method,
      inAsync: inner ? inner.async : true,
      inGenerator: !!inner?.generator,
    });
  };
  // The first token of the statement that ends at `index`, roughly: after the previous `;`, `{` or `}` at the same depth.
  const statementStart = (index: number) => {
    let i = index - 1;
    for (; i >= 0; i--) {
      const text = tokens[i].text;
      if (tokens[i].kind !== "punctuator") continue;
      if (text === ")" || text === "]" || text === "}") {
        if (text === "}" && i < index - 1 && partner[i] >= 0 && tokens[i + 1]?.text !== ")" && tokens[i + 1]?.text !== "," && tokens[i + 1]?.text !== ";" && tokens[i + 1]?.text !== ".") break;
        if (partner[i] >= 0) i = partner[i];
      } else if (text === ";" || text === "{") break;
    }
    return tokens[Math.min(i + 1, index)].start;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const frame = frames[frames.length - 1];
    const previous = tokens[index - 1];

    if (token.kind === "name") {
      if (previous?.text === "." || previous?.text === "?.") {
        if (!token.text.startsWith("#")) properties.add(token.text);
        continue;
      }
      if ((frame.kind === "object" || frame.kind === "class") && !isKeyword(token.text) && !token.text.startsWith("#") && /^[:(=;]$/.test(tokens[index + 1]?.text ?? "")) {
        if (previous?.text === "{" || previous?.text === "," || previous?.text === ";" || previous?.text === "}" || isKeyword(previous?.text ?? "")) properties.add(token.text);
      }
      if (token.text === "class") {
        pendingClass = true;
        const name = tokens[index + 1];
        if (name?.kind === "name" && !isKeyword(name.text) && frame.kind === "block" && previous?.text !== "=" && previous?.text !== "(") frame.bindings.push({ name: name.text, kind: "class", constant: false });
      } else if (token.text === "function" && frame.kind === "block" && (!previous || /^[;{}]$/.test(previous.text) || previous.text === "async" || previous.text === "export")) {
        const name = tokens[index + 1]?.text === "*" ? tokens[index + 2] : tokens[index + 1];
        if (name?.kind === "name" && !isKeyword(name.text)) frame.bindings.push({ name: name.text, kind: "function", constant: false });
      } else if ((token.text === "const" || token.text === "let" || token.text === "var") && (frame.kind === "block" || frame.kind === "(")) {
        const name = tokens[index + 1];
        if (name?.kind === "name" && !isKeyword(name.text)) {
          const holder = frame.kind === "(" ? pendingParameters : frame.bindings;
          const initializer = tokens[index + 2]?.text === "=" ? kindOfInitializer(tokens, index + 3) : ({ kind: "unknown" } as const);
          holder.push({ name: name.text, constant: token.text === "const", ...initializer });
        }
      }
      continue;
    }
    if (token.kind !== "punctuator") continue;

    if (token.text === "(") {
      frames.push({ kind: "(", bindings: [], head: previous?.text ?? "", loop: false });
      const close = partner[index];
      const after = tokens[close + 1]?.text;
      if (close > 0 && (after === "{" || after === "=>") && !/^(if|while|for|switch|with)$/.test(previous?.text ?? "")) {
        pendingParameters = [];
        for (let i = index + 1; i < close; i++) {
          if (tokens[i].kind === "punctuator" && partner[i] > i) i = partner[i];
          else if (tokens[i].kind === "name" && !isKeyword(tokens[i].text) && /^[(,]|\.\.\.$/.test(tokens[i - 1].text)) pendingParameters.push({ name: tokens[i].text, kind: "parameter", constant: false });
        }
      }
    } else if (token.text === "[") frames.push({ kind: "[", bindings: [], head: "", loop: false });
    else if (token.text === ")" || token.text === "]") {
      if (frames.length > 1) frames.pop();
    } else if (token.text === "{") {
      let kind: Frame["kind"] = "object";
      let head = "";
      const text = previous?.text ?? ";";
      if (pendingClass && frame.kind !== "(" ) (kind = "class"), (pendingClass = false);
      else if (text === ")") {
        const before = tokens[partner[index - 1] - 1];
        head = before?.text ?? "";
        kind = head === "switch" ? "switch" : "block";
      } else if (text === "=>" || /^(else|try|finally|do|catch|static|;|\{|\})$/.test(text)) (kind = "block"), (head = text);
      else if (text === ":" && frame.kind !== "object") kind = "block";
      const created: Frame = { kind, bindings: [], head, loop: /^(for|while|do)$/.test(head) };
      if (kind === "block" && (text === "=>" || (text === ")" && !/^(if|while|for|switch|with|catch)$/.test(head)))) {
        const opening = text === ")" ? partner[index - 1] : index - 1;
        const method = frame.kind === "class" || frame.kind === "object";
        const lead = tokens.slice(Math.max(0, opening - 4), opening).map(t => t.text);
        created.function = { constructor: frame.kind === "class" && head === "constructor", method, async: lead.includes("async"), generator: lead.includes("*") };
        created.bindings = pendingParameters;
        pendingParameters = [];
      } else if (kind === "block" && (head === "for" || head === "catch")) {
        created.bindings = pendingParameters;
        pendingParameters = [];
      } else if (kind === "block" && head === "static") created.function = { constructor: false, method: true, async: false, generator: false };
      frames.push(created);
      if (kind === "block") {
        const newline = source.indexOf("\n", token.end);
        const next = tokens[index + 1];
        if (next && newline >= 0 && next.start > newline && next.text !== "}") {
          const functions = frames.filter(each => each.function);
          const inner = functions[functions.length - 1]?.function;
          // `super()` has to come first in a derived constructor, so no gap at the top of a constructor.
          if (!created.function?.constructor)
            gaps.push({
              offset: newline,
              indent: /^[ \t]*/.exec(source.slice(newline + 1))![0],
              bindings: frames.flatMap(each => each.bindings),
              inFunction: !!inner,
              inLoop: frames.slice(frames.findLastIndex(each => each.function) + 1).some(each => each.loop),
              inConstructor: !!inner?.constructor,
              inMethod: !!inner?.method,
              inAsync: inner ? inner.async : true,
              inGenerator: !!inner?.generator,
            });
        }
      }
    } else if (token.text === "}") {
      const closed = frames.length > 1 ? frames.pop()! : frame;
      const outer = frames[frames.length - 1];
      if (outer.kind === "block" && (closed.kind === "block" || closed.kind === "class" || closed.kind === "switch")) gapAfter(index);
    } else if (token.text === ";" && frame.kind === "block") gapAfter(index);
  }
  return { tokens, partner, gaps, properties: [...properties], top };
}
