// strings of any values, strict equalities of any values, single characters of any strings
const big = "wörd€\u{1F600}x".repeat(3), rope = big + "-" + "abc".repeat(40), eight = "letters and digits 0123456789 äöü\xff".repeat(2);
const sub = eight.substring(3, 60), wideSub = rope.slice(5, 80), made = [1, 2, 3].join("/") + String(Date.now() > 0);
const symbol = Symbol("s"), object = { toString() { return "obj"; }, valueOf() { return 7; } }, plain = {}, list = [1, 2], fn = function named() {};
const values = JSON.parse('[0,1,2,7,9,10,99,100,255,256,1023,1024,1025,65535,65536,2147483647,-1,-2,-1023,-1024,-2147483648,0.5,1.5,-0.5,1e21,1e-7,123456789.25,4294967295,9007199254740991,true,false,null,"","0","1","text","-0","NaN"]');
values.push(-0, NaN, Infinity, -Infinity, undefined, 5n, 1023n, -1n, symbol, Symbol.iterator, object, plain, list, fn, big, rope, eight, sub, wideSub, made, 2 ** 31, -(2 ** 31) - 1, 0.1 + 0.2, Number("12"), Math.sqrt(16), 1 / 3, new Number(5), new String("text"));
const doubles = Float64Array.from([0, -0, 1, 2, 1023, 1024, NaN, 0.5, 255, -1]);
for (const d of doubles) values.push(d);
function template(v) { try { return `${v}`; } catch (e) { return e.name; } }
function call(v) { try { return String(v); } catch (e) { return e.name; } }
function joined(v) { try { return "" + v; } catch (e) { return e.name; } }
function after(v) { try { return v + ""; } catch (e) { return e.name; } }
function same(a, b) { return a === b; }
function other(a, b) { return a !== b; }
function loose(a, b) { try { return a == b; } catch (e) { return e.name; } }
function branch(a, b) { if (a === b) return 1; return 2; }
function count(xs, k) { let n = 0; for (let i = 0; i < xs.length; i++) if (xs[i] === k) n++; return n; }
function countOf(rs, k) { let n = 0; for (const r of rs) if (r.v === k) n++; return n; }
function pairs(rs) { let n = 0; for (let i = 0; i < rs.length; i++) for (let j = 0; j < rs.length; j++) if (rs[i].v === rs[j].v) n += i * 3 + j; return n; }
function chars(t) { const out = []; for (let i = -1; i <= t.length; i++) out.push(t[i]); return out; }
function ats(t) { let s = ""; for (let i = 0; i <= t.length; i++) s += t.charAt(i) + (t.at(-i) ?? "u"); return s; }
function codes(t) { const out = []; for (let i = 0; i < t.length; i++) out.push(t[i].charCodeAt(0), t.substring(i, i + 1).length, t.slice(i, i + 1)); return out.join(); }
function each(t) { const out = []; for (const c of t) out.push(c); return out; }
function eachAny(t) { let s = 0, l = ""; for (const c of t) { s += c.length; l = c + l; } return s + l; }
function lengths(xs) { let s = 0; for (let i = 0; i < xs.length; i++) { try { s += `${xs[i]}`.length + String(xs[i]).length; } catch { s += 1000; } } return s; }
const show = v => typeof v === "symbol" ? v.toString() : typeof v === "object" ? "o" : typeof v + String(v).slice(0, 30);
for (const v of values) console.log(show(v), template(v), call(v), joined(v), after(v));
for (let i = 0; i < values.length; i++) {
  let line = show(values[i]);
  for (let j = 0; j < values.length; j++) line += " " + (same(values[i], values[j]) ? 1 : 0) + (other(values[i], values[j]) ? 1 : 0) + branch(values[i], values[j]) + String(loose(values[i], values[j])).slice(0, 1);
  console.log(line, count(values, values[i]), countOf(values.map(v => ({ v })), values[i]));
}
console.log(pairs(values.map(v => ({ v }))), lengths(values));
for (const t of [big, rope, eight, sub, wideSub, made, "", "a", "é", "€", "\ud800", "a😀b", "x" + rope]) console.log(chars(t).map(String).join(), ats(t), codes(t), each(t).join("|"), eachAny(t));
for (let i = 0; i < 1100; i += 7) console.log(template(i), call(i), joined(i), template(-i), call(i + 0.5));
console.log(chars(["p", "q"]).join(), each([1, "b"]).join());
