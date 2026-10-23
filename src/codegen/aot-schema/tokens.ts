import { SchemaError, type Location } from "./source.ts";

export type TokenKind = "word" | "integer" | "text" | "punctuation";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly location: Location;
}

const punctuation = [
  "...",
  "..",
  "->",
  "=>",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  "<",
  ">",
  ":",
  ";",
  ",",
  "=",
  "|",
  "?",
  "/",
  "+",
  "*",
  "\\",
] as const;

const closerOf: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}", "<": ">" };
const closers: ReadonlySet<string> = new Set(Object.values(closerOf));

const wordPattern = /[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/y;
const integerPattern = /0x[0-9a-fA-F]+|-?[0-9]+/y;

function matchAt(pattern: RegExp, line: string, index: number): string | null {
  pattern.lastIndex = index;
  return pattern.exec(line)?.[0] ?? null;
}

function scanText(line: string, start: number, location: Location): Token {
  const end = line.indexOf('"', start + 1);
  if (end < 0) throw new SchemaError(location, "unterminated text");
  return { kind: "text", text: line.slice(start + 1, end), location };
}

function scanToken(line: string, index: number, location: Location): { token: Token; end: number } {
  if (line[index] === '"') {
    const token = scanText(line, index, location);
    return { token, end: index + token.text.length + 2 };
  }
  const word = matchAt(wordPattern, line, index);
  if (word !== null) return { token: { kind: "word", text: word, location }, end: index + word.length };
  const integer = matchAt(integerPattern, line, index);
  if (integer !== null) return { token: { kind: "integer", text: integer, location }, end: index + integer.length };
  for (const text of punctuation) {
    if (line.startsWith(text, index))
      return { token: { kind: "punctuation", text, location }, end: index + text.length };
  }
  throw new SchemaError(location, `unexpected character '${line[index]}'`);
}

function scanLine(path: string, lineNumber: number, line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if (character === " " || character === "\t" || character === "\r") {
      index += 1;
      continue;
    }
    if (character === "#") break;
    const { token, end } = scanToken(line, index, { path, line: lineNumber, column: index + 1 });
    tokens.push(token);
    index = end;
  }
  return tokens;
}

export function isPunctuation(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "punctuation" && token.text === text;
}

function trackBracket(token: Token, open: Token[]): void {
  if (token.kind !== "punctuation") return;
  if (token.text in closerOf) {
    open.push(token);
    return;
  }
  if (!closers.has(token.text)) return;
  const opener = open.pop();
  if (opener === undefined || closerOf[opener.text] !== token.text)
    throw new SchemaError(token.location, `unexpected '${token.text}'`);
}

export function tokenize(path: string, text: string): Token[][] {
  const declarations: Token[][] = [];
  const open: Token[] = [];
  let current: Token[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const tokens = scanLine(path, index + 1, lines[index]);
    const isContinued = isPunctuation(tokens.at(-1), "\\");
    if (isContinued) tokens.pop();
    for (const token of tokens) {
      if (isPunctuation(token, "\\")) throw new SchemaError(token.location, "unexpected '\\'");
      trackBracket(token, open);
      current.push(token);
    }
    if (current.length > 0 && open.length === 0 && !isContinued) {
      declarations.push(current);
      current = [];
    }
  }
  const unclosed = open.at(-1);
  if (unclosed !== undefined) throw new SchemaError(unclosed.location, `unclosed '${unclosed.text}'`);
  if (current.length > 0) declarations.push(current);
  return declarations;
}

export class Cursor {
  readonly #tokens: readonly Token[];
  #index = 0;

  constructor(tokens: readonly Token[]) {
    if (tokens.length === 0) throw new Error("a declaration has at least one token");
    this.#tokens = tokens;
  }

  get hasMore(): boolean {
    return this.#index < this.#tokens.length;
  }

  peek(offset = 0): Token | undefined {
    return this.#tokens[this.#index + offset];
  }

  get location(): Location {
    return (this.peek() ?? this.#tokens[this.#tokens.length - 1]).location;
  }

  at(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token !== undefined && token.kind !== "text" && token.text === text;
  }

  atWord(offset = 0): boolean {
    return this.peek(offset)?.kind === "word";
  }

  expected(description: string): SchemaError {
    const token = this.peek();
    if (token === undefined)
      return new SchemaError(this.location, `expected ${description} at the end of the declaration`);
    return new SchemaError(token.location, `expected ${description}, found '${token.text}'`);
  }

  next(): Token {
    const token = this.peek();
    if (token === undefined) throw new SchemaError(this.location, "unexpected end of the declaration");
    this.#index += 1;
    return token;
  }

  accept(text: string): boolean {
    if (!this.at(text)) return false;
    this.#index += 1;
    return true;
  }

  expect(text: string): void {
    if (!this.accept(text)) throw this.expected(`'${text}'`);
  }

  #take(kind: TokenKind, description: string): Token {
    if (this.peek()?.kind !== kind) throw this.expected(description);
    return this.next();
  }

  word(): Token {
    return this.#take("word", "a name");
  }

  integer(): bigint {
    return BigInt(this.#take("integer", "an integer").text);
  }

  text(): string {
    return this.#take("text", "a text").text;
  }

  finish(): void {
    const token = this.peek();
    if (token !== undefined) throw new SchemaError(token.location, `unexpected '${token.text}'`);
  }

  takeSegment(): Token[] {
    const start = this.#index;
    let depth = 0;
    for (let token = this.peek(); token !== undefined; token = this.peek()) {
      if (depth === 0 && isPunctuation(token, ";")) break;
      if (token.kind === "punctuation") depth += Number(token.text in closerOf) - Number(closers.has(token.text));
      this.#index += 1;
    }
    return this.#tokens.slice(start, this.#index);
  }
}
