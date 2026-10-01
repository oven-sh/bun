// Preload for a test run: records every call of transformSync, transform, scan and scanImports of Bun.Transpiler.
//
//   TRANSPILER_LOG=/tmp/calls.jsonl <bun binary> test --preload <this file> test/bundler/transpiler/transpiler.test.js
//
// One JSON line per call: {"file": test file relative to the working directory, "line": line of the outermost
// frame inside that file (the statement of the test body that led to the call), "lines": every frame line of
// the file from the innermost one, "method", "loader" (argument, else the option of the constructor, else null),
// "deco": the tsconfig of the constructor turns experimentalDecorators on, "opts": the constructor options
// without loader, "code", "ok", "out" (transformSync only, cut at 4000 characters), "errors": [message, ...]}.
// In a run where every test passes, a call that throws is a rejection that the test expects.
const { appendFileSync } = require("node:fs");
const LOG = process.env.TRANSPILER_LOG;
if (LOG) {
  Error.stackTraceLimit = 80;
  const cwd = process.cwd() + "/";
  const Orig = Bun.Transpiler;
  const options = new WeakMap();
  const Patched = new Proxy(Orig, {
    construct(target, args, newTarget) {
      const o = Reflect.construct(target, args, newTarget === Patched ? target : newTarget);
      options.set(o, args[0]);
      return o;
    },
  });
  Bun.Transpiler = Patched;
  const site = () => {
    const frames = [];
    let file = null;
    for (const l of String(new Error().stack).split("\n")) {
      const m = /\(?((?:\/|[A-Za-z]:)[^():]*\.test\.[cm]?[jt]sx?):(\d+):\d+\)?\s*$/.exec(l);
      if (!m) continue;
      file ??= m[1];
      if (m[1] === file) frames.push(Number(m[2]));
    }
    return { file: file ? (file.startsWith(cwd) ? file.slice(cwd.length) : file) : null, frames };
  };
  const decoOf = opts => {
    let t = opts?.tsconfig;
    if (typeof t === "string") {
      try {
        t = JSON.parse(t);
      } catch {
        return false;
      }
    }
    return !!t?.compilerOptions?.experimentalDecorators;
  };
  const textOf = code => (typeof code === "string" ? code : code == null ? String(code) : Buffer.from(code).toString("utf8"));
  const record = (self, method, code, rest, ok, out, err) => {
    const opts = options.get(self);
    const { file, frames } = site();
    const list = err && Array.isArray(err.errors) && err.errors.length ? err.errors : err ? [err] : [];
    const { loader: optLoader, ...others } = opts && typeof opts === "object" ? opts : {};
    let optsText;
    try {
      optsText = JSON.stringify(others);
    } catch {
      optsText = "?";
    }
    const rec = {
      file,
      line: frames.length ? frames[frames.length - 1] : null,
      lines: frames,
      method,
      loader: (typeof rest[0] === "string" ? rest[0] : null) ?? optLoader ?? null,
      deco: decoOf(opts),
      opts: optsText,
      code: textOf(code),
      ok,
    };
    if (ok && method === "transformSync" && typeof out === "string") rec.out = out.length > 4000 ? out.slice(0, 4000) : out;
    if (!ok) rec.errors = list.map(x => String(x?.message ?? x));
    appendFileSync(LOG, JSON.stringify(rec) + "\n");
  };
  for (const method of ["transformSync", "scan", "scanImports"]) {
    const orig = Orig.prototype[method];
    Orig.prototype[method] = function (code, ...rest) {
      let out;
      try {
        out = orig.call(this, code, ...rest);
      } catch (e) {
        record(this, method, code, rest, false, undefined, e);
        throw e;
      }
      record(this, method, code, rest, true, out, null);
      return out;
    };
  }
  const origTransform = Orig.prototype.transform;
  Orig.prototype.transform = function (code, ...rest) {
    let p;
    try {
      p = origTransform.call(this, code, ...rest);
    } catch (e) {
      record(this, "transform", code, rest, false, undefined, e);
      throw e;
    }
    if (p && typeof p.then === "function") {
      p.then(
        out => record(this, "transform", code, rest, true, out, null),
        e => record(this, "transform", code, rest, false, undefined, e),
      );
    }
    return p;
  };
}
