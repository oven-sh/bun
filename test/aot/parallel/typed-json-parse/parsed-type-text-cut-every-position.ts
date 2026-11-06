// Parsed by type text cut at every position is a syntax error.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Item {
  id: number;
  name: string;
  tags: string[];
  inner: { ok: boolean; none: null };
}

const whole = '{"id":-12.5e+1,"name":"a\\u0041\\n","tags":["x","y"],"inner":{"ok":true,"none":null}}';

function classOf(run: () => unknown): string {
  try {
    run();
    return "value";
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}

attempt("whole", () => JSON.parse(whole) as Item);
const cut: string[] = [];
for (let end = 0; end < whole.length; end++) cut.push(classOf(() => JSON.parse(whole.slice(0, end)) as Item));
console.log("cut after each character:", cut.every(name => name === "SyntaxError") ? "always a SyntaxError" : cut.join(" "));

const started: string[] = [];
for (let start = 1; start < whole.length; start++) started.push(classOf(() => JSON.parse(whole.slice(start)) as Item));
console.log("started after each character:", started.every(name => name === "SyntaxError") ? "always a SyntaxError" : started.join(" "));

const tails = [",", "}", "]", "x", "{}", "null", '"', "\u0000", "﻿", "/", "//", "/**/", " ", " ", "\v", "\f"];
for (const tail of tails) attempt("followed by " + JSON.stringify(tail), () => classOf(() => JSON.parse(whole + tail) as Item));
for (const head of [",", "﻿", " ", "\v", "+", "(", "'"]) attempt("after " + JSON.stringify(head), () => classOf(() => JSON.parse(head + whole) as Item));

const broken = [
  "",
  " ",
  "{",
  "{}x",
  '{"id":1,}',
  '{,"id":1}',
  '{"id" 1}',
  '{"id":}',
  "{id:1}",
  "{'id':1}",
  '{"id":01}',
  '{"id":1.}',
  '{"id":.5}',
  '{"id":+1}',
  '{"id":1e}',
  '{"id":0x10}',
  '{"id":NaN}',
  '{"id":Infinity}',
  '{"id":-}',
  '{"id":- 1}',
  '{"id":1_000}',
  '{"id":1n}',
  '{"id":undefined}',
  '{"id":True}',
  '{"id":nul}',
  '{"name":"\\x41"}',
  '{"name":"\\u12"}',
  '{"name":"\\u12G4"}',
  '{"name":"\\"}',
  '{"name":"a\nb"}',
  '{"name":"a\tb"}',
  '{"name":"\u0000"}',
  '{"tags":[1,]}',
  '{"tags":[,1]}',
  '{"tags":[1 2]}',
  '{"tags":[}',
  '{"tags":]}',
  '{"inner":{]}',
];
for (const text of broken) attempt(JSON.stringify(text), () => classOf(() => JSON.parse(text) as Item));
