"use strict";
function change(o) { try { if ("v" in o) o.v = "changed"; else o.v = 9; } catch {} }
class K { constructor(v, n) { this.v = v; this.n = n; } }
function t_typeof_number(o, i) { return typeof o.v === "number" ? "n" + (o.v + 1) : "o" + String(o.v); }
function l_typeof_number(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += typeof o.v === "number" ? "n" + (o.v + 1) : "o" + String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("typeof-number", l_typeof_number(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_typeof_number(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("typeof-number", r); }
function t_typeof_not(o, i) { return typeof o.v !== "number" ? "o" + String(o.v) : "n" + (o.v * 2); }
function l_typeof_not(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += typeof o.v !== "number" ? "o" + String(o.v) : "n" + (o.v * 2); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("typeof-not", l_typeof_not(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_typeof_not(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("typeof-not", r); }
function t_typeof_string(o, i) { return typeof o.v === "string" ? o.v.length + o.v : "x" + typeof o.v; }
function l_typeof_string(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += typeof o.v === "string" ? o.v.length + o.v : "x" + typeof o.v; } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("typeof-string", l_typeof_string(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_typeof_string(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("typeof-string", r); }
function t_typeof_object(o, i) { return typeof o.v === "object" ? "ob" + (o.v === null) : "no" + String(o.v); }
function l_typeof_object(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += typeof o.v === "object" ? "ob" + (o.v === null) : "no" + String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("typeof-object", l_typeof_object(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_typeof_object(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("typeof-object", r); }
function t_typeof_function(o, i) { return typeof o.v === "function" ? o.v(3) : String(o.v); }
function l_typeof_function(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += typeof o.v === "function" ? o.v(3) : String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("typeof-function", l_typeof_function(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_typeof_function(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("typeof-function", r); }
function t_truthy(o, i) { return o.v ? "t" + String(o.v) + typeof o.v : "f" + String(o.v); }
function l_truthy(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v ? "t" + String(o.v) + typeof o.v : "f" + String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("truthy", l_truthy(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_truthy(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("truthy", r); }
function t_not(o, i) { return !o.v ? "f" + String(o.v) : "t" + String(o.v); }
function l_not(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += !o.v ? "f" + String(o.v) : "t" + String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("not", l_not(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_not(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("not", r); }
function t_null(o, i) { return o.v === null ? "null" : String(o.v); }
function l_null(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v === null ? "null" : String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("null", l_null(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_null(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("null", r); }
function t_not_null(o, i) { return o.v !== null ? String(o.v) : "null"; }
function l_not_null(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v !== null ? String(o.v) : "null"; } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("not-null", l_not_null(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_not_null(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("not-null", r); }
function t_loose_null(o, i) { return o.v == null ? "none" : String(o.v) + typeof o.v; }
function l_loose_null(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v == null ? "none" : String(o.v) + typeof o.v; } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("loose-null", l_loose_null(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_loose_null(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("loose-null", r); }
function t_undefined(o, i) { return o.v === undefined ? "u" : String(o.v); }
function l_undefined(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v === undefined ? "u" : String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("undefined", l_undefined(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_undefined(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("undefined", r); }
function t_not_undefined(o, i) { return o.v !== undefined ? String(o.v) : "u" + o.v; }
function l_not_undefined(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v !== undefined ? String(o.v) : "u" + o.v; } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("not-undefined", l_not_undefined(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_not_undefined(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("not-undefined", r); }
function t_and(o, i) { return String(o.v && (o.v.key ?? o.v)); }
function l_and(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += String(o.v && (o.v.key ?? o.v)); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("and", l_and(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_and(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("and", r); }
function t_or(o, i) { return String(o.v || "dflt") + (o.v ? String(o.v) : ""); }
function l_or(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += String(o.v || "dflt") + (o.v ? String(o.v) : ""); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("or", l_or(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_or(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("or", r); }
function t_coalesce(o, i) { return String(o.v ?? "dflt") + (o.v === undefined ? o.v : ""); }
function l_coalesce(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += String(o.v ?? "dflt") + (o.v === undefined ? o.v : ""); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("coalesce", l_coalesce(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_coalesce(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("coalesce", r); }
function t_key(o, i) { return o.v !== null && o.v !== undefined ? String(o.v.key) + (o.v.length ?? "none") : "none"; }
function l_key(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v !== null && o.v !== undefined ? String(o.v.key) + (o.v.length ?? "none") : "none"; } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("key", l_key(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_key(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("key", r); }
function t_instance(o, i) { return o.v instanceof Array ? o.v[0] + o.v.length : String(o.v); }
function l_instance(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v instanceof Array ? o.v[0] + o.v.length : String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("instance", l_instance(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_instance(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("instance", r); }
function t_array(o, i) { return Array.isArray(o.v) ? o.v.length + "l" + o.v[1] : String(o.v); }
function l_array(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += Array.isArray(o.v) ? o.v.length + "l" + o.v[1] : String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("array", l_array(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_array(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("array", r); }
function t_less(o, i) { return o.v < 3 ? "less" + String(o.v) : "not" + String(o.v); }
function l_less(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v < 3 ? "less" + String(o.v) : "not" + String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("less", l_less(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_less(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("less", r); }
function t_equal(o, i) { return o.v === 1 ? "one" + (o.v + 1) : String(o.v); }
function l_equal(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v === 1 ? "one" + (o.v + 1) : String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("equal", l_equal(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_equal(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("equal", r); }
function t_compare_both(o, i) { return o.v > 1 && o.v < 6 ? "in" + (o.v - 1) : "out" + String(o.v); }
function l_compare_both(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += o.v > 1 && o.v < 6 ? "in" + (o.v - 1) : "out" + String(o.v); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("compare-both", l_compare_both(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_compare_both(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("compare-both", r); }
function t_nested(o, i) { return typeof o.v === "number" ? (o.v > 2 ? "big" + (o.v | 0) : "small" + o.v) : (typeof o.v === "string" ? o.v.length : o.v === null ? "nil" : String(o.v)); }
function l_nested(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += typeof o.v === "number" ? (o.v > 2 ? "big" + (o.v | 0) : "small" + o.v) : (typeof o.v === "string" ? o.v.length : o.v === null ? "nil" : String(o.v)); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("nested", l_nested(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_nested(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("nested", r); }
function t_switch(o, i) { return (() => { switch (typeof o.v) { case "number": return o.v + 1; case "string": return o.v.length; case "object": return o.v ? 1 : 0; default: return String(o.v); } })(); }
function l_switch(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i); try { r += (() => { switch (typeof o.v) { case "number": return o.v + 1; case "string": return o.v.length; case "object": return o.v ? 1 : 0; default: return String(o.v); } })(); } catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("switch", l_switch(11)); { let r = ""; for (let i = 0; i < 11; i++) { try { r += t_switch(new K((i & 1 ? { key: i } : null), i), i); } catch (e) { r += e.constructor.name; } r += ";"; } console.log("switch", r); }
function b_nothing(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { r += "N" + String(o.v) + typeof o.v; } else { r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { r += String(o.v?.key) + String(o.v); }
  if (o.v) { r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("nothing", b_nothing(11));
function b_store_same(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { o.v = "stored"; r += "N" + String(o.v) + typeof o.v; } else { o.v = "stored"; r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { o.v = "stored"; r += String(o.v?.key) + String(o.v); }
  if (o.v) { o.v = "stored"; r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { o.v = "stored"; r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("store-same", b_store_same(11));
function b_store_alias(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { q.v = 77; r += "N" + String(o.v) + typeof o.v; } else { q.v = 77; r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { q.v = 77; r += String(o.v?.key) + String(o.v); }
  if (o.v) { q.v = 77; r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { q.v = 77; r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("store-alias", b_store_alias(11));
function b_call(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { change(o); r += "N" + String(o.v) + typeof o.v; } else { change(o); r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { change(o); r += String(o.v?.key) + String(o.v); }
  if (o.v) { change(o); r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { change(o); r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("call", b_call(11));
function b_call_maybe(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { if (i % 5 === 2) change(o); r += "N" + String(o.v) + typeof o.v; } else { if (i % 5 === 2) change(o); r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { if (i % 5 === 2) change(o); r += String(o.v?.key) + String(o.v); }
  if (o.v) { if (i % 5 === 2) change(o); r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { if (i % 5 === 2) change(o); r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("call-maybe", b_call_maybe(11));
function b_delete(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { delete o.v; r += "N" + String(o.v) + typeof o.v; } else { delete o.v; r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { delete o.v; r += String(o.v?.key) + String(o.v); }
  if (o.v) { delete o.v; r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { delete o.v; r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("delete", b_delete(11));
function b_getter(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { o.other; r += "N" + String(o.v) + typeof o.v; } else { o.other; r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { o.other; r += String(o.v?.key) + String(o.v); }
  if (o.v) { o.other; r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { o.other; r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("getter", b_getter(11));
function b_loop(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new K((i & 1 ? { key: i } : null), i), q = o; try {
  if (typeof o.v === "number") { for (let j = 0; j < 2; j++) { r += String(o.v); if (j === 0 && i % 3 === 1) o.v = j; } r += "N" + String(o.v) + typeof o.v; } else { for (let j = 0; j < 2; j++) { r += String(o.v); if (j === 0 && i % 3 === 1) o.v = j; } r += "O" + String(o.v) + typeof o.v; }
  if (o.v !== null) { for (let j = 0; j < 2; j++) { r += String(o.v); if (j === 0 && i % 3 === 1) o.v = j; } r += String(o.v?.key) + String(o.v); }
  if (o.v) { for (let j = 0; j < 2; j++) { r += String(o.v); if (j === 0 && i % 3 === 1) o.v = j; } r += "T" + String(o.v); } else { r += "F" + String(o.v); }
  while (o.v === undefined) { for (let j = 0; j < 2; j++) { r += String(o.v); if (j === 0 && i % 3 === 1) o.v = j; } r += "W" + String(o.v); break; }
  const w = o.v === 5 ? (r += "five", o.v) : o.v; r += String(w);
} catch (e) { r += e.constructor.name; } r += ";"; } return r; }
console.log("loop", b_loop(11));
