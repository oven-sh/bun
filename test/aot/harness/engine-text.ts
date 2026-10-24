// The text of the engine's compiler (Source/JavaScriptCore/aot but its tests), for the tests that go by it.
import { setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Each test reads every source of the compiler, beside whatever else the machine is doing.
setDefaultTimeout(120_000);

export const sources = [
  process.env.AOT_ENGINE_DIRECTORY,
  ...[process.env.BUN_WEBKIT_PATH, join(import.meta.dir, "..", "..", "..", "vendor", "WebKit")]
    .filter(path => path !== undefined)
    .map(path => join(path, "Source", "JavaScriptCore", "aot")),
]
  .filter(path => path !== undefined)
  .find(path => existsSync(join(path, "ir")));

export function sayWhenSkipped(test: string) {
  if (!sources)
    console.error(
      `SKIPPED: ${test}: there is no Source/JavaScriptCore/aot in $BUN_WEBKIT_PATH or vendor/WebKit, and no $AOT_ENGINE_DIRECTORY`,
    );
}

/** Comments and the insides of literals become spaces: every position and line stays where it was. */
export function withoutCommentsAndLiterals(text: string): string {
  return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, found =>
    found.replace(/[^\n]/g, " "),
  );
}

/** Each .h and .cpp that goes into a compiler, by its path under aot/ with forward slashes, in order. */
export function* filesOfCompiler(): Generator<{ name: string; text: string }> {
  const names = [...new Bun.Glob("**/*.{h,cpp}").scanSync(sources!)].map(file => file.replaceAll("\\", "/")).sort();
  for (const name of names) {
    if (name.startsWith("tests/") || name.endsWith("TestCommands.cpp")) continue;
    yield { name, text: withoutCommentsAndLiterals(readFileSync(join(sources!, name), "utf8")) };
  }
}

/** The position of what closes the bracket at `open`, or -1. */
export function closingOf(text: string, open: number): number {
  const opening = text[open];
  const closing = { "(": ")", "{": "}", "[": "]" }[opening];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opening) depth++;
    else if (text[i] === closing && --depth === 0) return i;
  }
  return -1;
}

export function lineOf(text: string, position: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < position; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

export type Switch = { line: number; labels: string[]; hasDefault: boolean };

/** Every switch of a text that went through withoutCommentsAndLiterals(). The labels of a switch inside another belong to the inner one alone. */
export function switchesOf(text: string): Switch[] {
  const found: Switch[] = [];
  for (const { index } of text.matchAll(/\bswitch\s*\(/g)) {
    const condition = closingOf(text, text.indexOf("(", index));
    const open = text.indexOf("{", condition);
    const end = closingOf(text, open);
    if (condition < 0 || end < 0) continue;
    let body = text.slice(open + 1, end);
    for (let inner; (inner = /\bswitch\s*\(/.exec(body)); ) {
      const innerEnd = closingOf(body, body.indexOf("{", closingOf(body, body.indexOf("(", inner.index))));
      body = body.slice(0, inner.index) + body.slice(innerEnd < 0 ? body.length : innerEnd + 1);
    }
    found.push({
      line: lineOf(text, index),
      labels: [...body.matchAll(/\bcase\s+([A-Za-z_][\w:]*)\s*:(?!:)/g)].map(label => label[1]),
      hasDefault: /\bdefault\s*:/.test(body),
    });
  }
  return found;
}
