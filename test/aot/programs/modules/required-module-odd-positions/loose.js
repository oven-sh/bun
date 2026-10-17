export function viaEval() { const m = require("./lib.ts"); return eval("m.constant + m.twice(1)"); }
export function viaEvalOfACopy() { const { twice, constant } = require("./lib.ts"); return eval("twice(constant)"); }
export function viaFunction() { const m = require("./lib.ts"); return new Function("m", "return m.constant")(m); }
export function* yields() { const m = require("./lib.ts"); yield m.constant; const { twice } = m; yield twice(3); yield Object.keys(m).length; }
export function inASwitch(k) { switch (k) { case 1: { const m = require("./lib.ts"); return m.word; } default: return "none"; } }
export function assigned() { let a, t; ({ constant: a, twice: t } = require("./lib.ts")); return t(a); }
export function byDefault(m = require("./lib.ts")) { return m.constant; }
export class Fields { lib = require("./lib.ts"); static held = require("./lib.ts"); read() { return this.lib.constant + Fields.held.constant; } }
export function early() { try { return typeof m + m.constant; } catch (e) { return e.constructor.name; } const m = require("./lib.ts"); }
export function inALoop() { let s = 0; for (let i = 0; i < 3; i++) { const m = require("./lib.ts"); s += m.constant; (() => { s += m.twice(i); })(); } return s; }
export function labelled() { const m = require("./lib.ts"); const o = { m }; return o.m.constant + [m][0].constant + (m, m).constant + (true && m).constant + (m ?? 0).constant; }
