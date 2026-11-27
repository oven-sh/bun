// Loops over the characters of literals. Beside some of them the string becomes an atom and the collector runs.
// STATISTIC: LiteralCharactersHoisted >= 30
function mix(h: number, v: unknown): number { const s = typeof v === "number" ? v : typeof v === "string" ? (v.length ? v.charCodeAt(0) * 31 + v.length : 5) : v === undefined ? 3 : 11; return (Math.imul(h, 33) + (s === s ? s * 4 : 17) | 0) & 0xfffffff; }
const bag: Record<string, number> = {}; const bytes = new Uint8Array(30); for (let k = 0; k < 30; k++) bytes[k] = k * 11;
let kept: unknown[] = []; function junk(): void { kept = []; for (let k = 0; k < 2000; k++) kept.push({ k, s: "s" + k }); Bun.gc(true); }
let lines = 0; function say(name: string, v: number): void { console.log(name, v); lines++; }
const T_ascii = "let x = 12; function foo(a, b) { return a + b * 31; } // end";
const T_latin = "caf\u00e9 \u00fcber \u00ff end of it";
const T_wide = "wide \u20ac text \u4e2d with \u00e9";
const T_pair = "a\ud83d\ude00b\ud83dc\ude00d";
const T_hex = "0123456789abcdef";
const T_two = "xy";
const T_one = "q";
const T_none = "";
async function ascii_index_past_async(): Promise<number> { let h = 7; for (let k = 0; k <= T_ascii.length + 1; k++) h = mix((await null, h), T_ascii[k]); return h; }
say("ascii_index_past_async", await ascii_index_past_async());
function ascii_index_odd_closure() { let h = 7; return (): number => { for (const k of [0, -0, 1, NaN, 2.5, Infinity, -Infinity, 1e9, -1]) h = mix(h, T_ascii[k]); return h; }; }
{ const f = ascii_index_odd_closure(); say("ascii_index_odd_closure", f() + f()); }
function* ascii_index_whiles_gen(): Generator<number> { let h = 7; let k = 0; while (k < T_ascii.length) { while (k < T_ascii.length && mix(0, T_ascii[k]) % 3 !== 0) k++; h = mix((yield h, h), k); k++; } yield h; }
{ let t = 0; for (const v of ascii_index_whiles_gen()) t = mix(t, v); say("ascii_index_whiles_gen", t); }
function ascii_index_each_closure() { let h = 7; return (): number => { [0, 1, 2, 3, 99].forEach(k => { h = mix(h, T_ascii[k]); }); return h; }; }
{ const f = ascii_index_each_closure(); say("ascii_index_each_closure", f() + f()); }
class C_ascii_at_mask_method { run(): number { let h = 7; for (let k = 0; k < 40; k++) h = mix(h, T_ascii.at((k * 7) & 15)); return h; } }
say("ascii_at_mask_method", new C_ascii_at_mask_method().run());
let h_ascii_at_half_module = 7; { for (let k = 0; k < 20; k++) h_ascii_at_half_module = mix(h_ascii_at_half_module, T_ascii.at(k * 0.5)); }
say("ascii_at_half_module", h_ascii_at_half_module);
class C_ascii_at_atoms_method { run(): number { let h = 7; for (let k = 0; k < T_ascii.length; k++) { h = mix(h, T_ascii.at(k)); if (k === 1) { bag[T_ascii] = k; junk(); } h = mix(h, bag[T_ascii]); } return h; } }
say("ascii_at_atoms_method", new C_ascii_at_atoms_method().run());
class C_ascii_char_tries_method { run(): number { let h = 7; for (let k = 0; k < T_ascii.length; k++) { try { h = mix(h, T_ascii.charAt(k)); if (k % 5 === 4) throw k; } catch (e) { h = mix(h, T_ascii.charAt(e as number)); } finally { h = mix(h, T_ascii.charAt(k + 1)); } } return h; } }
say("ascii_char_tries_method", new C_ascii_char_tries_method().run());
function ascii_point_rest_func(): number { let h = 7; for (let k = 0; k < 40; k++) h = mix(h, T_ascii.codePointAt((k * 7) % (T_ascii.length || 1))); return h; }
say("ascii_point_rest_func", ascii_point_rest_func() + ascii_point_rest_func());
async function ascii_point_label_async(): Promise<number> { let h = 7; out: for (let j = 0; j < 4; j++) for (let k = 0; k < T_ascii.length; k++) { h = mix((await null, h), T_ascii.codePointAt(k)); if (k === j + 2) continue out; if (j === 3) break out; } return h; }
say("ascii_point_label_async", await ascii_point_label_async());
function ascii_point_cut_func(): number { let h = 7; for (let k = 0; k < T_ascii.length; k++) { h = mix(h, T_ascii.codePointAt(k)); h = mix(h, T_ascii.slice(k, k + 2)); if (T_ascii.indexOf("b", k) > 3) h = mix(h, 1); } return h; }
say("ascii_point_cut_func", ascii_point_cut_func() + ascii_point_cut_func());
function latin_code_up_closure() { let h = 7; return (): number => { for (let k = 0; k < T_latin.length; k++) h = mix(h, T_latin.charCodeAt(k)); return h; }; }
{ const f = latin_code_up_closure(); say("latin_code_up_closure", f() + f()); }
function* latin_code_below_gen(): Generator<number> { let h = 7; for (let k = -2; k < T_latin.length; k++) h = mix((yield h, h), T_latin.charCodeAt(k)); yield h; }
{ let t = 0; for (const v of latin_code_below_gen()) t = mix(t, v); say("latin_code_below_gen", t); }
function latin_code_view_closure() { let h = 7; return (): number => { for (let k = 0; k < bytes.length; k++) h = mix(h, T_latin.charCodeAt(bytes[k] & 63)); return h; }; }
{ const f = latin_code_view_closure(); say("latin_code_view_closure", f() + f()); }
let h_latin_code_maps_module = 7; { h_latin_code_maps_module = mix(h_latin_code_maps_module, [0, 1, 2, 5].map(k => T_latin.charCodeAt(k)).join()); }
say("latin_code_maps_module", h_latin_code_maps_module);
let h_latin_at_past_module = 7; { for (let k = 0; k <= T_latin.length + 1; k++) h_latin_at_past_module = mix(h_latin_at_past_module, T_latin.at(k)); }
say("latin_at_past_module", h_latin_at_past_module);
let h_latin_at_whiles_module = 7; { let k = 0; while (k < T_latin.length) { while (k < T_latin.length && mix(0, T_latin.at(k)) % 3 !== 0) k++; h_latin_at_whiles_module = mix(h_latin_at_whiles_module, k); k++; } }
say("latin_at_whiles_module", h_latin_at_whiles_module);
function latin_at_each_func(): number { let h = 7; [0, 1, 2, 3, 99].forEach(k => { h = mix(h, T_latin.at(k)); }); return h; }
say("latin_at_each_func", latin_at_each_func() + latin_at_each_func());
async function latin_char_mask_async(): Promise<number> { let h = 7; for (let k = 0; k < 40; k++) h = mix((await null, h), T_latin.charAt((k * 7) & 15)); return h; }
say("latin_char_mask_async", await latin_char_mask_async());
function latin_char_half_func(): number { let h = 7; for (let k = 0; k < 20; k++) h = mix(h, T_latin.charAt(k * 0.5)); return h; }
say("latin_char_half_func", latin_char_half_func() + latin_char_half_func());
function latin_char_twice_func(): number { let h = 7; for (let k = 0; k < T_latin.length; k++) { h = mix(h, T_latin.charAt(k)); for (let m = 0; m < 3; m++) h = mix(h, T_latin.charAt(m)); } return h; }
say("latin_char_twice_func", latin_char_twice_func() + latin_char_twice_func());
function* latin_char_atoms_gen(): Generator<number> { let h = 7; for (let k = 0; k < T_latin.length; k++) { h = mix((yield h, h), T_latin.charAt(k)); if (k === 1) { bag[T_latin] = k; junk(); } h = mix(h, bag[T_latin]); } yield h; }
{ let t = 0; for (const v of latin_char_atoms_gen()) t = mix(t, v); say("latin_char_atoms_gen", t); }
function* wide_code_rest_gen(): Generator<number> { let h = 7; for (let k = 0; k < 40; k++) h = mix((yield h, h), T_wide.charCodeAt((k * 7) % (T_wide.length || 1))); yield h; }
{ let t = 0; for (const v of wide_code_rest_gen()) t = mix(t, v); say("wide_code_rest_gen", t); }
function wide_code_label_closure() { let h = 7; return (): number => { out: for (let j = 0; j < 4; j++) for (let k = 0; k < T_wide.length; k++) { h = mix(h, T_wide.charCodeAt(k)); if (k === j + 2) continue out; if (j === 3) break out; } return h; }; }
{ const f = wide_code_label_closure(); say("wide_code_label_closure", f() + f()); }
class C_wide_code_cut_method { run(): number { let h = 7; for (let k = 0; k < T_wide.length; k++) { h = mix(h, T_wide.charCodeAt(k)); h = mix(h, T_wide.slice(k, k + 2)); if (T_wide.indexOf("b", k) > 3) h = mix(h, 1); } return h; } }
say("wide_code_cut_method", new C_wide_code_cut_method().run());
let h_wide_index_below_module = 7; { for (let k = -2; k < T_wide.length; k++) h_wide_index_below_module = mix(h_wide_index_below_module, T_wide[k]); }
say("wide_index_below_module", h_wide_index_below_module);
class C_wide_index_view_method { run(): number { let h = 7; for (let k = 0; k < bytes.length; k++) h = mix(h, T_wide[bytes[k] & 63]); return h; } }
say("wide_index_view_method", new C_wide_index_view_method().run());
async function wide_index_twice_async(): Promise<number> { let h = 7; for (let k = 0; k < T_wide.length; k++) { h = mix((await null, h), T_wide[k]); for (let m = 0; m < 3; m++) h = mix(h, T_wide[m]); } return h; }
say("wide_index_twice_async", await wide_index_twice_async());
async function wide_index_tries_async(): Promise<number> { let h = 7; for (let k = 0; k < T_wide.length; k++) { try { h = mix((await null, h), T_wide[k]); if (k % 5 === 4) throw k; } catch (e) { h = mix(h, T_wide[e as number]); } finally { h = mix(h, T_wide[k + 1]); } } return h; }
say("wide_index_tries_async", await wide_index_tries_async());
function wide_index_maps_func(): number { let h = 7; h = mix(h, [0, 1, 2, 5].map(k => T_wide[k]).join()); return h; }
say("wide_index_maps_func", wide_index_maps_func() + wide_index_maps_func());
function wide_char_whiles_func(): number { let h = 7; let k = 0; while (k < T_wide.length) { while (k < T_wide.length && mix(0, T_wide.charAt(k)) % 3 !== 0) k++; h = mix(h, k); k++; } return h; }
say("wide_char_whiles_func", wide_char_whiles_func() + wide_char_whiles_func());
function wide_point_up_closure() { let h = 7; return (): number => { for (let k = 0; k < T_wide.length; k++) h = mix(h, T_wide.codePointAt(k)); return h; }; }
{ const f = wide_point_up_closure(); say("wide_point_up_closure", f() + f()); }
function wide_point_mask_closure() { let h = 7; return (): number => { for (let k = 0; k < 40; k++) h = mix(h, T_wide.codePointAt((k * 7) & 15)); return h; }; }
{ const f = wide_point_mask_closure(); say("wide_point_mask_closure", f() + f()); }
function* wide_point_half_gen(): Generator<number> { let h = 7; for (let k = 0; k < 20; k++) h = mix((yield h, h), T_wide.codePointAt(k * 0.5)); yield h; }
{ let t = 0; for (const v of wide_point_half_gen()) t = mix(t, v); say("wide_point_half_gen", t); }
let h_wide_point_atoms_module = 7; { for (let k = 0; k < T_wide.length; k++) { h_wide_point_atoms_module = mix(h_wide_point_atoms_module, T_wide.codePointAt(k)); if (k === 1) { bag[T_wide] = k; junk(); } h_wide_point_atoms_module = mix(h_wide_point_atoms_module, bag[T_wide]); } }
say("wide_point_atoms_module", h_wide_point_atoms_module);
class C_pair_code_past_method { run(): number { let h = 7; for (let k = 0; k <= T_pair.length + 1; k++) h = mix(h, T_pair.charCodeAt(k)); return h; } }
say("pair_code_past_method", new C_pair_code_past_method().run());
let h_pair_code_down_module = 7; { for (let k = T_pair.length - 1; k >= 0; k--) h_pair_code_down_module = mix(h_pair_code_down_module, T_pair.charCodeAt(k)); }
say("pair_code_down_module", h_pair_code_down_module);
let h_pair_index_rest_module = 7; { for (let k = 0; k < 40; k++) h_pair_index_rest_module = mix(h_pair_index_rest_module, T_pair[(k * 7) % (T_pair.length || 1)]); }
say("pair_index_rest_module", h_pair_index_rest_module);
function pair_index_label_func(): number { let h = 7; out: for (let j = 0; j < 4; j++) for (let k = 0; k < T_pair.length; k++) { h = mix(h, T_pair[k]); if (k === j + 2) continue out; if (j === 3) break out; } return h; }
say("pair_index_label_func", pair_index_label_func() + pair_index_label_func());
async function pair_index_cut_async(): Promise<number> { let h = 7; for (let k = 0; k < T_pair.length; k++) { h = mix((await null, h), T_pair[k]); h = mix(h, T_pair.slice(k, k + 2)); if (T_pair.indexOf("b", k) > 3) h = mix(h, 1); } return h; }
say("pair_index_cut_async", await pair_index_cut_async());
function pair_at_below_func(): number { let h = 7; for (let k = -2; k < T_pair.length; k++) h = mix(h, T_pair.at(k)); return h; }
say("pair_at_below_func", pair_at_below_func() + pair_at_below_func());
function* pair_at_view_gen(): Generator<number> { let h = 7; for (let k = 0; k < bytes.length; k++) h = mix((yield h, h), T_pair.at(bytes[k] & 63)); yield h; }
{ let t = 0; for (const v of pair_at_view_gen()) t = mix(t, v); say("pair_at_view_gen", t); }
function pair_at_twice_closure() { let h = 7; return (): number => { for (let k = 0; k < T_pair.length; k++) { h = mix(h, T_pair.at(k)); for (let m = 0; m < 3; m++) h = mix(h, T_pair.at(m)); } return h; }; }
{ const f = pair_at_twice_closure(); say("pair_at_twice_closure", f() + f()); }
function pair_at_tries_closure() { let h = 7; return (): number => { for (let k = 0; k < T_pair.length; k++) { try { h = mix(h, T_pair.at(k)); if (k % 5 === 4) throw k; } catch (e) { h = mix(h, T_pair.at(e as number)); } finally { h = mix(h, T_pair.at(k + 1)); } } return h; }; }
{ const f = pair_at_tries_closure(); say("pair_at_tries_closure", f() + f()); }
let h_pair_char_rest_module = 7; { for (let k = 0; k < 40; k++) h_pair_char_rest_module = mix(h_pair_char_rest_module, T_pair.charAt((k * 7) % (T_pair.length || 1))); }
say("pair_char_rest_module", h_pair_char_rest_module);
class C_pair_point_whiles_method { run(): number { let h = 7; let k = 0; while (k < T_pair.length) { while (k < T_pair.length && mix(0, T_pair.codePointAt(k)) % 3 !== 0) k++; h = mix(h, k); k++; } return h; } }
say("pair_point_whiles_method", new C_pair_point_whiles_method().run());
let h_pair_point_each_module = 7; { [0, 1, 2, 3, 99].forEach(k => { h_pair_point_each_module = mix(h_pair_point_each_module, T_pair.codePointAt(k)); }); }
say("pair_point_each_module", h_pair_point_each_module);
class C_hex_code_up_method { run(): number { let h = 7; for (let k = 0; k < T_hex.length; k++) h = mix(h, T_hex.charCodeAt(k)); return h; } }
say("hex_code_up_method", new C_hex_code_up_method().run());
class C_hex_code_mask_method { run(): number { let h = 7; for (let k = 0; k < 40; k++) h = mix(h, T_hex.charCodeAt((k * 7) & 15)); return h; } }
say("hex_code_mask_method", new C_hex_code_mask_method().run());
async function hex_code_half_async(): Promise<number> { let h = 7; for (let k = 0; k < 20; k++) h = mix((await null, h), T_hex.charCodeAt(k * 0.5)); return h; }
say("hex_code_half_async", await hex_code_half_async());
function hex_code_atoms_func(): number { let h = 7; for (let k = 0; k < T_hex.length; k++) { h = mix(h, T_hex.charCodeAt(k)); if (k === 1) { bag[T_hex] = k; junk(); } h = mix(h, bag[T_hex]); } return h; }
say("hex_code_atoms_func", hex_code_atoms_func() + hex_code_atoms_func());
async function hex_index_past_async(): Promise<number> { let h = 7; for (let k = 0; k <= T_hex.length + 1; k++) h = mix((await null, h), T_hex[k]); return h; }
say("hex_index_past_async", await hex_index_past_async());
function hex_index_down_closure() { let h = 7; return (): number => { for (let k = T_hex.length - 1; k >= 0; k--) h = mix(h, T_hex[k]); return h; }; }
{ const f = hex_index_down_closure(); say("hex_index_down_closure", f() + f()); }
function hex_at_cut_closure() { let h = 7; return (): number => { for (let k = 0; k < T_hex.length; k++) { h = mix(h, T_hex.at(k)); h = mix(h, T_hex.slice(k, k + 2)); if (T_hex.indexOf("b", k) > 3) h = mix(h, 1); } return h; }; }
{ const f = hex_at_cut_closure(); say("hex_at_cut_closure", f() + f()); }
function* hex_char_below_gen(): Generator<number> { let h = 7; for (let k = -2; k < T_hex.length; k++) h = mix((yield h, h), T_hex.charAt(k)); yield h; }
{ let t = 0; for (const v of hex_char_below_gen()) t = mix(t, v); say("hex_char_below_gen", t); }
function hex_char_mask_closure() { let h = 7; return (): number => { for (let k = 0; k < 40; k++) h = mix(h, T_hex.charAt((k * 7) & 15)); return h; }; }
{ const f = hex_char_mask_closure(); say("hex_char_mask_closure", f() + f()); }
let h_hex_char_view_module = 7; { for (let k = 0; k < bytes.length; k++) h_hex_char_view_module = mix(h_hex_char_view_module, T_hex.charAt(bytes[k] & 63)); }
say("hex_char_view_module", h_hex_char_view_module);
class C_hex_char_twice_method { run(): number { let h = 7; for (let k = 0; k < T_hex.length; k++) { h = mix(h, T_hex.charAt(k)); for (let m = 0; m < 3; m++) h = mix(h, T_hex.charAt(m)); } return h; } }
say("hex_char_twice_method", new C_hex_char_twice_method().run());
let h_hex_char_maps_module = 7; { h_hex_char_maps_module = mix(h_hex_char_maps_module, [0, 1, 2, 5].map(k => T_hex.charAt(k)).join()); }
say("hex_char_maps_module", h_hex_char_maps_module);
function hex_point_rest_func(): number { let h = 7; for (let k = 0; k < 40; k++) h = mix(h, T_hex.codePointAt((k * 7) % (T_hex.length || 1))); return h; }
say("hex_point_rest_func", hex_point_rest_func() + hex_point_rest_func());
function two_code_each_func(): number { let h = 7; [0, 1, 2, 3, 99].forEach(k => { h = mix(h, T_two.charCodeAt(k)); }); return h; }
say("two_code_each_func", two_code_each_func() + two_code_each_func());
async function two_index_up_async(): Promise<number> { let h = 7; for (let k = 0; k < T_two.length; k++) h = mix((await null, h), T_two[k]); return h; }
say("two_index_up_async", await two_index_up_async());
function two_index_half_closure() { let h = 7; return (): number => { for (let k = 0; k < 20; k++) h = mix(h, T_two[k * 0.5]); return h; }; }
{ const f = two_index_half_closure(); say("two_index_half_closure", f() + f()); }
function* two_index_atoms_gen(): Generator<number> { let h = 7; for (let k = 0; k < T_two.length; k++) { h = mix((yield h, h), T_two[k]); if (k === 1) { bag[T_two] = k; junk(); } h = mix(h, bag[T_two]); } yield h; }
{ let t = 0; for (const v of two_index_atoms_gen()) t = mix(t, v); say("two_index_atoms_gen", t); }
function two_index_tries_closure() { let h = 7; return (): number => { for (let k = 0; k < T_two.length; k++) { try { h = mix(h, T_two[k]); if (k % 5 === 4) throw k; } catch (e) { h = mix(h, T_two[e as number]); } finally { h = mix(h, T_two[k + 1]); } } return h; }; }
{ const f = two_index_tries_closure(); say("two_index_tries_closure", f() + f()); }
let h_two_at_past_module = 7; { for (let k = 0; k <= T_two.length + 1; k++) h_two_at_past_module = mix(h_two_at_past_module, T_two.at(k)); }
say("two_at_past_module", h_two_at_past_module);
class C_two_at_down_method { run(): number { let h = 7; for (let k = T_two.length - 1; k >= 0; k--) h = mix(h, T_two.at(k)); return h; } }
say("two_at_down_method", new C_two_at_down_method().run());
let h_two_at_whiles_module = 7; { let k = 0; while (k < T_two.length) { while (k < T_two.length && mix(0, T_two.at(k)) % 3 !== 0) k++; h_two_at_whiles_module = mix(h_two_at_whiles_module, k); k++; } }
say("two_at_whiles_module", h_two_at_whiles_module);
async function two_point_below_async(): Promise<number> { let h = 7; for (let k = -2; k < T_two.length; k++) h = mix((await null, h), T_two.codePointAt(k)); return h; }
say("two_point_below_async", await two_point_below_async());
function two_point_mask_func(): number { let h = 7; for (let k = 0; k < 40; k++) h = mix(h, T_two.codePointAt((k * 7) & 15)); return h; }
say("two_point_mask_func", two_point_mask_func() + two_point_mask_func());
function two_point_view_func(): number { let h = 7; for (let k = 0; k < bytes.length; k++) h = mix(h, T_two.codePointAt(bytes[k] & 63)); return h; }
say("two_point_view_func", two_point_view_func() + two_point_view_func());
async function two_point_twice_async(): Promise<number> { let h = 7; for (let k = 0; k < T_two.length; k++) { h = mix((await null, h), T_two.codePointAt(k)); for (let m = 0; m < 3; m++) h = mix(h, T_two.codePointAt(m)); } return h; }
say("two_point_twice_async", await two_point_twice_async());
function two_point_maps_func(): number { let h = 7; h = mix(h, [0, 1, 2, 5].map(k => T_two.codePointAt(k)).join()); return h; }
say("two_point_maps_func", two_point_maps_func() + two_point_maps_func());
function* one_code_rest_gen(): Generator<number> { let h = 7; for (let k = 0; k < 40; k++) h = mix((yield h, h), T_one.charCodeAt((k * 7) % (T_one.length || 1))); yield h; }
{ let t = 0; for (const v of one_code_rest_gen()) t = mix(t, v); say("one_code_rest_gen", t); }
function one_code_odd_closure() { let h = 7; return (): number => { for (const k of [0, -0, 1, NaN, 2.5, Infinity, -Infinity, 1e9, -1]) h = mix(h, T_one.charCodeAt(k)); return h; }; }
{ const f = one_code_odd_closure(); say("one_code_odd_closure", f() + f()); }
function* one_code_cut_gen(): Generator<number> { let h = 7; for (let k = 0; k < T_one.length; k++) { h = mix((yield h, h), T_one.charCodeAt(k)); h = mix(h, T_one.slice(k, k + 2)); if (T_one.indexOf("b", k) > 3) h = mix(h, 1); } yield h; }
{ let t = 0; for (const v of one_code_cut_gen()) t = mix(t, v); say("one_code_cut_gen", t); }
class C_one_at_half_method { run(): number { let h = 7; for (let k = 0; k < 20; k++) h = mix(h, T_one.at(k * 0.5)); return h; } }
say("one_at_half_method", new C_one_at_half_method().run());
let h_one_at_atoms_module = 7; { for (let k = 0; k < T_one.length; k++) { h_one_at_atoms_module = mix(h_one_at_atoms_module, T_one.at(k)); if (k === 1) { bag[T_one] = k; junk(); } h_one_at_atoms_module = mix(h_one_at_atoms_module, bag[T_one]); } }
say("one_at_atoms_module", h_one_at_atoms_module);
class C_one_at_tries_method { run(): number { let h = 7; for (let k = 0; k < T_one.length; k++) { try { h = mix(h, T_one.at(k)); if (k % 5 === 4) throw k; } catch (e) { h = mix(h, T_one.at(e as number)); } finally { h = mix(h, T_one.at(k + 1)); } } return h; } }
say("one_at_tries_method", new C_one_at_tries_method().run());
function one_char_past_func(): number { let h = 7; for (let k = 0; k <= T_one.length + 1; k++) h = mix(h, T_one.charAt(k)); return h; }
say("one_char_past_func", one_char_past_func() + one_char_past_func());
async function one_char_down_async(): Promise<number> { let h = 7; for (let k = T_one.length - 1; k >= 0; k--) h = mix((await null, h), T_one.charAt(k)); return h; }
say("one_char_down_async", await one_char_down_async());
function one_char_whiles_func(): number { let h = 7; let k = 0; while (k < T_one.length) { while (k < T_one.length && mix(0, T_one.charAt(k)) % 3 !== 0) k++; h = mix(h, k); k++; } return h; }
say("one_char_whiles_func", one_char_whiles_func() + one_char_whiles_func());
function one_point_up_closure() { let h = 7; return (): number => { for (let k = 0; k < T_one.length; k++) h = mix(h, T_one.codePointAt(k)); return h; }; }
{ const f = one_point_up_closure(); say("one_point_up_closure", f() + f()); }
function none_code_below_closure() { let h = 7; return (): number => { for (let k = -2; k < T_none.length; k++) h = mix(h, T_none.charCodeAt(k)); return h; }; }
{ const f = none_code_below_closure(); say("none_code_below_closure", f() + f()); }
function none_code_twice_closure() { let h = 7; return (): number => { for (let k = 0; k < T_none.length; k++) { h = mix(h, T_none.charCodeAt(k)); for (let m = 0; m < 3; m++) h = mix(h, T_none.charCodeAt(m)); } return h; }; }
{ const f = none_code_twice_closure(); say("none_code_twice_closure", f() + f()); }
class C_none_code_maps_method { run(): number { let h = 7; h = mix(h, [0, 1, 2, 5].map(k => T_none.charCodeAt(k)).join()); return h; } }
say("none_code_maps_method", new C_none_code_maps_method().run());
let h_none_index_past_module = 7; { for (let k = 0; k <= T_none.length + 1; k++) h_none_index_past_module = mix(h_none_index_past_module, T_none[k]); }
say("none_index_past_module", h_none_index_past_module);
let h_none_index_rest_module = 7; { for (let k = 0; k < 40; k++) h_none_index_rest_module = mix(h_none_index_rest_module, T_none[(k * 7) % (T_none.length || 1)]); }
say("none_index_rest_module", h_none_index_rest_module);
class C_none_index_odd_method { run(): number { let h = 7; for (const k of [0, -0, 1, NaN, 2.5, Infinity, -Infinity, 1e9, -1]) h = mix(h, T_none[k]); return h; } }
say("none_index_odd_method", new C_none_index_odd_method().run());
async function none_index_cut_async(): Promise<number> { let h = 7; for (let k = 0; k < T_none.length; k++) { h = mix((await null, h), T_none[k]); h = mix(h, T_none.slice(k, k + 2)); if (T_none.indexOf("b", k) > 3) h = mix(h, 1); } return h; }
say("none_index_cut_async", await none_index_cut_async());
async function none_char_half_async(): Promise<number> { let h = 7; for (let k = 0; k < 20; k++) h = mix((await null, h), T_none.charAt(k * 0.5)); return h; }
say("none_char_half_async", await none_char_half_async());
function none_char_view_func(): number { let h = 7; for (let k = 0; k < bytes.length; k++) h = mix(h, T_none.charAt(bytes[k] & 63)); return h; }
say("none_char_view_func", none_char_view_func() + none_char_view_func());
function none_char_atoms_func(): number { let h = 7; for (let k = 0; k < T_none.length; k++) { h = mix(h, T_none.charAt(k)); if (k === 1) { bag[T_none] = k; junk(); } h = mix(h, bag[T_none]); } return h; }
say("none_char_atoms_func", none_char_atoms_func() + none_char_atoms_func());
function* none_char_tries_gen(): Generator<number> { let h = 7; for (let k = 0; k < T_none.length; k++) { try { h = mix((yield h, h), T_none.charAt(k)); if (k % 5 === 4) throw k; } catch (e) { h = mix(h, T_none.charAt(e as number)); } finally { h = mix(h, T_none.charAt(k + 1)); } } yield h; }
{ let t = 0; for (const v of none_char_tries_gen()) t = mix(t, v); say("none_char_tries_gen", t); }
function none_point_down_closure() { let h = 7; return (): number => { for (let k = T_none.length - 1; k >= 0; k--) h = mix(h, T_none.codePointAt(k)); return h; }; }
{ const f = none_point_down_closure(); say("none_point_down_closure", f() + f()); }
function* none_point_whiles_gen(): Generator<number> { let h = 7; let k = 0; while (k < T_none.length) { while (k < T_none.length && mix(0, T_none.codePointAt(k)) % 3 !== 0) k++; h = mix((yield h, h), k); k++; } yield h; }
{ let t = 0; for (const v of none_point_whiles_gen()) t = mix(t, v); say("none_point_whiles_gen", t); }
let h_none_point_label_module = 7; { out: for (let j = 0; j < 4; j++) for (let k = 0; k < T_none.length; k++) { h_none_point_label_module = mix(h_none_point_label_module, T_none.codePointAt(k)); if (k === j + 2) continue out; if (j === 3) break out; } }
say("none_point_label_module", h_none_point_label_module);
console.log(lines);
export {};
