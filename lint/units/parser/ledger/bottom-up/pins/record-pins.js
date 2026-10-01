// Preload that records what the existing tests give to the transpiler, and what comes back.
//
// usage (from the repository root, with the binary whose verdicts are wanted):
//   PIN_LOG=/tmp/pins.jsonl <bun> test --preload <this file> test/bundler/transpiler/transpiler.test.js
//   PIN_LOG=/tmp/pins.jsonl PIN_EXPECT_BUNDLED=$PWD/test/bundler/expectBundled.ts <bun> test --preload <this file> test/bundler/esbuild/ts.test.ts
//
// One JSON line per call of Bun.Transpiler.prototype.{transformSync,transform,scan,scanImports}:
//   {"m": method, "frames": ["<test file>:<line>", ... innermost first], "opts": <constructor options or null>,
//    "arg": <second argument when it is a string: the loader>, "code": <input text>, "len": <length>,
//    "ok": 1 | "err": [message, ...]}
// With PIN_EXPECT_BUNDLED set, the module at that path is replaced: itBundled(id, opts) builds nothing and writes
//   {"m": "itBundled", "id", "frames", "files": {path: text}, "bundleErrors", "bundleWarnings", "opts": {...scalars}}
// The frame to read is the LAST one of a record: the call inside the test body (helpers of the test file are nearer).
const { appendFileSync } = require("node:fs");

const LOG = process.env.PIN_LOG;
const CAP = 40000;

const log = rec => {
  if (LOG) appendFileSync(LOG, JSON.stringify(rec) + "\n");
};

const framesOf = () => {
  const out = [];
  for (const line of String(new Error().stack).split("\n")) {
    const m = /((?:\/[^():\s]+)+\.[cm]?[jt]sx?):(\d+):\d+\)?$/.exec(line.trim());
    if (m && m[1].includes("/test/") && !m[1].endsWith("record-pins.js")) out.push(m[1] + ":" + m[2]);
  }
  return out;
};

const messagesOf = e => {
  const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
  return list.map(x => String(x?.message ?? x));
};

const plain = v => {
  try {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  } catch {
    return "unserializable";
  }
};

const textOf = code => {
  if (typeof code === "string") return code;
  if (code instanceof ArrayBuffer || ArrayBuffer.isView(code)) {
    try {
      return new TextDecoder().decode(code);
    } catch {
      return null;
    }
  }
  return null;
};

const Orig = Bun.Transpiler;
const optionsOf = new WeakMap();

function Wrapped(options) {
  const t = new Orig(options);
  optionsOf.set(t, plain(options));
  return t;
}
Wrapped.prototype = Orig.prototype;
// The property is writable and not configurable: an assignment replaces it, defineProperty throws.
Bun.Transpiler = Wrapped;

for (const m of ["transformSync", "transform", "scan", "scanImports"]) {
  const f = Orig.prototype[m];
  if (typeof f !== "function") continue;
  Orig.prototype[m] = function (code, ...rest) {
    const text = textOf(code);
    const rec = { m, frames: framesOf(), opts: optionsOf.get(this) ?? null };
    if (typeof rest[0] === "string") rec.arg = rest[0];
    if (text === null) rec.input = typeof code;
    else {
      rec.len = text.length;
      if (text.length <= CAP) rec.code = text;
    }
    let r;
    try {
      r = f.call(this, code, ...rest);
    } catch (e) {
      rec.err = messagesOf(e);
      log(rec);
      throw e;
    }
    if (r && typeof r.then === "function") {
      r.then(
        () => {
          rec.ok = 1;
          log(rec);
        },
        e => {
          rec.err = messagesOf(e);
          log(rec);
        },
      );
      return r;
    }
    rec.ok = 1;
    log(rec);
    return r;
  };
}

if (process.env.PIN_EXPECT_BUNDLED) {
  const { mock } = require("bun:test");
  const fake = (id, opts) => {
    const files = {};
    for (const [k, v] of Object.entries(opts?.files ?? {})) {
      const t = textOf(v);
      if (t !== null && t.length <= CAP) files[k] = t;
    }
    const scalars = {};
    for (const [k, v] of Object.entries(opts ?? {})) {
      if (["string", "number", "boolean"].includes(typeof v)) scalars[k] = v;
    }
    log({
      m: "itBundled",
      id,
      frames: framesOf(),
      files,
      bundleErrors: plain(opts?.bundleErrors),
      bundleWarnings: plain(opts?.bundleWarnings),
      opts: scalars,
    });
    return { id, options: opts };
  };
  fake.only = fake;
  fake.skip = fake;
  fake.todo = fake;
  const dedent = (str, ...args) => {
    const s = typeof str === "string" ? str : String.raw({ raw: str.raw ?? str }, ...args);
    const lines = s.replace(/^\n/, "").split("\n");
    const indent = Math.min(...lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)[0].length));
    return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n").trim();
  };
  mock.module(process.env.PIN_EXPECT_BUNDLED, () => ({
    itBundled: fake,
    dedent,
    testForFile: () => ({}),
    decodeSourceMappingsLine: () => [],
    ESBUILD: undefined,
    RUN_UNCHECKED_TESTS: false,
    ESBUILD_PATH: "",
  }));
}
