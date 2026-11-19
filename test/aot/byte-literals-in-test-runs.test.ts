// A test may replace Buffer.from, TextEncoder.prototype.encode, Uint8Array.fromBase64 or Uint8Array.fromHex while the code under test calls it with constant arguments.
// The build encodes such calls ahead of time, in a test run as in an executable. Every call must still reach the replacement, as under `bun test`, whether or not the build can read what the test replaces.
// Where nothing is replaced, the run must copy the encoded bytes. Otherwise the other cases would show nothing.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

type Member = {
  object: string;
  hiddenObject: string;
  name: string;
  product: string;
  seen: string;
  /** How many calls in `product` the build encodes. */
  encoded: number;
};

const hidden = (constructor: string) => `globalThis[JSON.parse('"${constructor}"')]`;
const members: Record<string, Member> = {
  "Buffer.from": {
    object: "Buffer",
    hiddenObject: hidden("Buffer"),
    name: "from",
    product: `[Buffer.from("hi").toString("hex"), Buffer.from("6869", "hex").toString(), Buffer.from([104, 105]).toString()].join(" ")`,
    seen: "6869 hi hi 3",
    encoded: 2,
  },
  "TextEncoder.prototype.encode": {
    object: "TextEncoder.prototype",
    hiddenObject: `${hidden("TextEncoder")}.prototype`,
    name: "encode",
    product: `[String(new TextEncoder().encode("hi")), String(shared.encode("\\u20ac"))].join(" ")`,
    seen: "104,105 226,130,172 2",
    encoded: 0,
  },
  "Uint8Array.fromBase64": {
    object: "Uint8Array",
    hiddenObject: hidden("Uint8Array"),
    name: "fromBase64",
    product: `[String(Uint8Array.fromBase64("aGk=")), String(Uint8Array.fromBase64("-_-_", { alphabet: "base64url" }))].join(" ")`,
    seen: "104,105 251,255,191 2",
    encoded: 1,
  },
  "Uint8Array.fromHex": {
    object: "Uint8Array",
    hiddenObject: hidden("Uint8Array"),
    name: "fromHex",
    product: `String(Uint8Array.fromHex("6869"))`,
    seen: "104,105 1",
    encoded: 1,
  },
};

const counted = "function (...given) { calls++; return original.apply(this, given); }";
const replacements: Record<string, (member: Member) => string> = {
  "a store that names the member": ({ object, name }) => `const original = ${object}.${name};
  ${object}.${name} = ${counted};
  try { report(); } finally { ${object}.${name} = original; }`,
  "spyOn that names the member": ({ object, name }) => `const spy = spyOn(${object}, "${name}");
  try { report(() => spy.mock.calls.length); } finally { spy.mockRestore(); }`,
  "a store through an object that the build cannot read": ({
    hiddenObject,
    name,
  }) => `const object = ${hiddenObject}, original = object.${name};
  object.${name} = ${counted};
  try { report(); } finally { object.${name} = original; }`,
  "a store under a name that the build cannot read": ({
    object,
    name,
  }) => `const name = JSON.parse('"${name}"'), original = ${object}[name];
  ${object}[name] = ${counted};
  try { report(); } finally { ${object}[name] = original; }`,
  "a definition through an object that the build cannot read": ({
    hiddenObject,
    name,
  }) => `const object = ${hiddenObject}, original = object.${name};
  Object.defineProperty(object, "${name}", { value: ${counted}, configurable: true, writable: true });
  try { report(); } finally { Object.defineProperty(object, "${name}", { value: original, configurable: true, writable: true }); }`,
};

const filesOf = (member: Member, body: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "product.js": `const shared = new TextEncoder();
export function make() {
  return ${member.product};
}
`,
  "a.test.js": `import { spyOn, test } from "bun:test";
import { make } from "./product.js";
test("t", () => {
  let calls = 0;
  const report = (count = () => calls) => { const made = make(); console.error("SEEN " + made + " " + count()); };
  ${body}
  console.error("RESTORED " + make());
});
`,
});

async function outcomeOf(dir: string, ...flags: string[]) {
  const counts = join(dir, "counts");
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], dir, {
    ...bunEnv,
    BUN_JSC_aotCountsPath: counts,
  });
  const printed = (stdout + "\n" + stderr)
    .split("\n")
    .filter(line => line.startsWith("SEEN ") || line.startsWith("RESTORED "));
  const copied = flags.length
    ? readFileSync(counts, "utf8")
        .split("\n")
        .find(line => line.endsWith("\toperation:operationAOTCopyByteLiteral"))
    : undefined;
  return { printed, exitCode, copies: Number(copied?.split("\t")[0] ?? 0) };
}

for (const [memberName, member] of Object.entries(members)) {
  const made = member.seen.replace(/ \d+$/, "");

  test.concurrent(`${memberName}, nothing is replaced`, async () => {
    using dir = tempDir("aot-byte-literals", filesOf(member, "report();"));
    const printed = [`SEEN ${made} 0`, `RESTORED ${made}`];
    expect(await outcomeOf(String(dir))).toEqual({ printed, exitCode: 0, copies: 0 });
    expect(await outcomeOf(String(dir), "--aot")).toEqual({ printed, exitCode: 0, copies: 2 * member.encoded });
  });

  for (const [title, body] of Object.entries(replacements))
    test.concurrent(`${memberName}, ${title}`, async () => {
      using dir = tempDir("aot-byte-literals", filesOf(member, body(member)));
      const asPlain = { printed: ["SEEN " + member.seen, "RESTORED " + made], exitCode: 0 };
      expect(await outcomeOf(String(dir))).toMatchObject(asPlain);
      expect(await outcomeOf(String(dir), "--aot")).toMatchObject(asPlain);
    });
}
