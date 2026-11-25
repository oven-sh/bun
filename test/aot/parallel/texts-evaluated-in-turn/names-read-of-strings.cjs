const { fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
const text = `
const lines = [];
const show = v => typeof v === "function" ? "F" : typeof v + ":" + String(v);
const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name); } };
class Own { constructor() { this.defaultProps = 1; } get late() { return "own late"; } }
const values = ["div", "", "a" + lines.length + "b", "x".repeat(40), new String("object"), new Own(), { defaultProps: null }, function f() {}, 5, true, Symbol("s"), 10n, null, undefined, "w\\u0416"];
const sites = [v => v.defaultProps, v => v.late, v => v.length, v => v.at, v => v.trim(), v => v.missing === undefined, v => v?.deep?.er, v => { v.stored = 1; return v.stored; }, v => v.constructor.name, v => v.charCodeAt(0), v => v.toString(), v => v[0], v => v.valueOf === undefined, v => v.__proto__ === String.prototype];
const round = n => { for (let t = 0; t < n; t++) for (const site of sites) for (const v of values) attempt(() => site(v)); };
round(6);
for (const change of [
    () => { String.prototype.defaultProps = "added"; },
    () => { Object.defineProperty(String.prototype, "late", { get() { return typeof this; }, configurable: true }); },
    () => { Object.defineProperty(String.prototype, "late", { get() { "use strict"; return typeof this + this.length; }, configurable: true }); },
    () => { collect(); },
    () => { String.prototype.defaultProps = "changed"; },
    () => { Object.defineProperty(String.prototype, "stored", { set(v) { lines.push("set " + typeof this); }, get() { return "stored"; }, configurable: true }); },
    () => { delete String.prototype.defaultProps; delete String.prototype.late; delete String.prototype.stored; },
    () => { Object.setPrototypeOf(Own.prototype, { missing: 1, at: "own at" }); },
]) { attempt(() => { change(); return "changed"; }); round(3); }
lines.length + " " + lines.reduce((h, l) => { for (let k = 0; k < l.length; k++) h = (Math.imul(h, 31) + l.charCodeAt(k)) | 0; return h; }, 0) + "\\n" + lines.join("\\n");
`;
for (let t = 0; t < 2; t++) console.log((0, eval)("{" + text + "}"));
