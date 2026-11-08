import * as forms from "./forms";
const show = v => { try { return JSON.stringify(v, (k, x) => (typeof x === "function" ? "[fn]" : x === undefined ? "__undef__" : x)); } catch (e) { return String(v); } };
const out = {};
const inputs = [{ a: 1, b: 10 }, { a: 1, b: 10 }, { a: 2, b: 10 }, { a: 2, b: 20 }, { a: 1, b: 10 }];
for (const [name, fn] of Object.entries(forms)) {
  const rows = [];
  globalThis.__key = name;
  globalThis.__compiled = false;
  for (const inp of inputs) {
    const log = [];
    globalThis.__effects = [];
    let r;
    try {
      const el = fn({ ...inp, log: x => log.push("log:" + show(x)) });
      for (const eff of globalThis.__effects) eff();
      if (el === null) { rows.push("null " + log.join(",")); continue; } const props = el.props;
      const called = {};
      for (const k of ["onClick", "onFocus"]) if (typeof props[k] === "function") { try { called[k] = props[k](); } catch (e) { called[k] = "threw " + e.constructor.name; } } else called[k] = typeof props[k];
      r = show(props.children) + " " + show(called) + " " + log.join(",");
    } catch (e) {
      r = "THREW " + e.constructor.name;
    }
    rows.push(r);
  }
  out[name] = { rows, compiled: globalThis.__compiled };
}
console.log(JSON.stringify(out));
