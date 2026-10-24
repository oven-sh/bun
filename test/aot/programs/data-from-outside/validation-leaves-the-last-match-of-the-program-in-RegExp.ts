// RegExp.$1, RegExp.lastMatch and their like tell of the last match of the program. Validating a value, refusing one and reading the error change none of them.
import type { Schema } from "bun";
import { validate } from "bun:bundle";

interface Named {
  first: string & Schema.Pattern<"^(a+)(b*)$">;
  count: number;
  second: string & Schema.Pattern<"^(c+)(d*)$">;
  mail: string & Schema.Format<"email">;
  day: string & Schema.Format<"date">;
  home: string & Schema.Format<"url">;
  tag: `id-${bigint}`;
  size: `${number}px`;
  code: number & Schema.Pattern<"^(1)(2)$">;
  either: (string & Schema.Pattern<"^(e+)$">) | (string & Schema.Pattern<"^(f+)$">) | { deep: string & Schema.Format<"uuid"> };
}

function lastMatch(): string {
  return [RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.input, RegExp.leftContext, RegExp.rightContext, RegExp.lastParen].join("|");
}

function createValid(): any {
  return {
    first: "aab",
    count: 1,
    second: "ccd",
    mail: "ada@example.com",
    day: "2026-02-28",
    home: "https://example.com/",
    tag: "id-12",
    size: "4px",
    code: 12,
    either: "ff",
  };
}

// What the parser makes is an ordinary object. What a literal of the program makes need not be.
function parsed(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

function wide(value: any): any {
  for (let i = 0; i < 40; i++) value["extra" + i] = i;
  return value;
}

function matchesWhileRead(value: any): any {
  Object.defineProperty(value, "second", {
    enumerable: true,
    get() {
      /(g+)(h*)/.exec("-ggh-");
      return "ccd";
    },
  });
  return value;
}

const changes: [string, (value: any) => any][] = [
  ["valid", value => value],
  ["count", value => ({ ...value, count: "no" })],
  ["first", value => ({ ...value, first: "zz" })],
  ["mail", value => ({ ...value, mail: "nobody" })],
  ["tag", value => ({ ...value, tag: "id-x" })],
  ["code", value => ({ ...value, code: 13 })],
  ["either", value => ({ ...value, either: "gg" })],
  ["deep", value => ({ ...value, either: { deep: "00000000-0000-0000-0000-000000000000" } })],
  ["deep refused", value => ({ ...value, either: { deep: "0" } })],
  ["last", value => ({ ...value, either: 5 })],
];

const sources: [string, (value: any) => unknown][] = [
  ["a literal", value => validate<Named>(value)],
  ["a parsed object", value => validate<Named>(parsed(value))],
  ["a wide object", value => validate<Named>(wide(parsed(value)))],
  ["a text", value => JSON.parse<Named>(JSON.stringify(value))],
  ["a text that ends early", value => JSON.parse<Named>(JSON.stringify(value).slice(0, -1))],
  ["a text and a reviver", value => JSON.parse<Named>(JSON.stringify(value), (_, member) => member)],
];

const readers: [string, (error: any) => unknown][] = [
  ["message", error => error.message],
  ["issues", error => error.issues],
  ["String", error => String(error)],
  ["stack", error => error.stack],
  ["descriptor", error => Object.getOwnPropertyDescriptor(error, "issues")],
  ["spread", error => ({ ...error })],
  ["stringify", error => JSON.stringify(error)],
  ["inspect", error => Bun.inspect(error)],
  ["clone", error => structuredClone(error)],
];

let lines = 0;
let wrong = 0;
function expect(what: string, expected: string): void {
  lines++;
  if (lastMatch() === expected) return;
  wrong++;
  console.log(what, "expected", expected, "found", lastMatch());
}

const mine = "xxy|xx|y|-xxy-|-|-|y";
const between = "xyy|x|yy|+xyy+|+|+|yy";

for (const [source, run] of sources) {
  for (const [change, apply] of changes) {
    for (const [reader, read] of readers) {
      /(x+)(y*)/.exec("-xxy-");
      let caught: any;
      try {
        run(apply(createValid()));
      } catch (error) {
        caught = error;
      }
      expect(`${source}, ${change}: behind the call`, mine);
      if (caught === undefined) break;
      /(x+)(y*)/.exec("+xyy+");
      read(caught);
      expect(`${source}, ${change}: behind ${reader}`, between);
    }

    /(x+)(y*)/.exec("-xxy-");
    try {
      run(apply(createValid()));
    } catch {}
    expect(`${source}, ${change}: nobody looks at the error`, mine);
  }
}

for (const [change, apply] of changes) {
  /(x+)(y*)/.exec("-xxy-");
  let outcome = "valid";
  try {
    validate<Named>(matchesWhileRead(apply(createValid())));
  } catch (error: any) {
    outcome = error.message;
  }
  console.log("a getter that matches,", change + ":", lastMatch(), "|", outcome);
}

/(x+)(y*)/.exec("-xxy-");
RegExp.input = "stored by the program";
validate<Named>(parsed(createValid()));
console.log(RegExp.input, RegExp.$1);

console.log(lines, "looks,", wrong, "wrong");
