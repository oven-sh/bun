// A string between two written ones, joined outside loops: flat, empty, ropes, pieces of other strings, of 8 and 16 bits, of one character, too long.
const asText = v => (typeof v === "string" ? v : String(v));
function narrow(s) { return "before " + s + " behind"; }
function template(s) { return `<a href="${s}">`; }
function wide(s) { return "中文 " + s + " behind"; }
function wideBehind(s) { return "before " + s + " 中文"; }
function wideAround(s) { return "中文 " + s + " 中文"; }
function converted(v) { return "number " + v + " behind it"; }
function nested(depth, tag) { if (depth === 0) return { array: [0, 1, 2], string: "String for key " + tag + " in leaf node" }; return { left: nested(depth - 1, tag), right: nested(depth - 1, tag) }; }
function leaves(node) { return node.string === undefined ? leaves(node.left) + "," + leaves(node.right) : node.string; }
const part = asText(process.argv.length > 99 ? 0 : "0123456789abcdefghijklmnopqrstuvwxyz");
let growing = ""; for (let i = 0; i < 400; i++) growing += part[i % 36];
const texts = ["", "x", part, part.slice(3, 20), part + "|" + part, part.repeat(3), growing, growing.slice(5, 300), "été", "中", part + "中", "中" + part, part.replace("a", ""), part.substring(7, 7), part.at(-1), JSON.parse('"q\\u0000r"'), asText(12.5), asText(null)];
const log = [];
for (const join of [narrow, template, wide, wideBehind, wideAround]) {
  let joined = "";
  for (const t of texts) { const s = join(t); joined += s.length + ":" + s.slice(0, 12) + ".." + s.slice(-9) + ";"; if (join(s).length !== join("").length + s.length || s.indexOf(t) < 0) joined += "WRONG"; }
  log.push(joined);
}
for (const v of [0, -0, 1.5, NaN, true, null, undefined, 10n, { toString() { log.push("asked"); return "obj"; } }, [1, 2]]) log.push(converted(v));
try { converted(Symbol("s")); } catch (e) { log.push(e.constructor.name); }
log.push(leaves(nested(3, asText(0.25))), leaves(nested(1, "")), leaves(nested(0, growing)).length);
let rope = "y".repeat(1024); try { for (let i = 0; i < 20; i++) rope = rope + rope; } catch (e) { log.push(e.constructor.name); }
const nearlyAll = [rope]; try { let more = "y".repeat(2 ** 10 - 24); for (let half = "y".repeat(1024), i = 0; i < 20; i++) { more = more + half; half = half + half; } nearlyAll.push(rope + more); } catch (e) { log.push(e.constructor.name); }
for (const join of [narrow, template]) for (const s of nearlyAll) try { log.push(s.length, join(s).length); } catch (e) { log.push(e.constructor.name + " " + e.message); }
let chain = part; for (let i = 0; i < 60; i++) chain = narrow(chain);
log.push(chain.length, chain.slice(200, 260), chain.slice(-30));
console.log(log.join("\n"));
