// localeCompare of receivers and operands of every kind, called by name, through variables and in sorts.
const base = JSON.parse('["", "a", "b", "A", "B", "ab", "aB", "Ab", "abc", "abcdefgh", "abcdefgi", "abcdefghi", "abcdefgh1", "item10", "item2", "item-2", "item_2", "item 2", "résumé", "resume", "Résumé", "ß", "ss", "ä", "z", "Z", "ö", "日本", "日", "\\u0000", "a\\u0000b", "a\\tb", "a b", "~", "!", "1", "10", "2", "é", "e\\u0301", "\\ud83d\\ude00", "a\\u0301", "ﬀ", "ff"]');
const long = base[9].repeat(5) + JSON.parse('"tail"'), pieces = (long + " " + base.join(" ")).split(" "), ropes = base.map((s, i) => s + base[(i + 1) % base.length]), subs = base.map((s, i) => long.slice(i % 20, i % 20 + 7));
const strings = [...base, ...ropes.slice(0, 12), ...subs.slice(0, 8), ...pieces.slice(0, 12), long, long + "x"];
const others = [undefined, null, 1, 10n, true, { toString() { return "abc"; } }, [1, 2], Symbol.iterator.description, new String("ab")];
const all = process.argv[2] === "all"; let lines = 0, hash = 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line); else if (lines % 97 === 0) console.log(lines, hash); }
const compare = (x, y) => x.localeCompare(y), compareRows = (x, y) => x.name.localeCompare(y.name) || x.id - y.id, down = function (x, y) { return y.localeCompare(x); };
function key(x) { return typeof x === "string" ? x : x === null ? "null" : typeof x; }
for (const x of strings) { let line = ""; for (const y of strings) { const c = compare(x, y); line += c < 0 ? "<" : c > 0 ? ">" : "="; if (c !== -compare(y, x) || (c !== -1 && c !== 0 && c !== 1)) line += "?" + c; if (Object.is(c, -0)) line += "-0"; } say(key(x) + line); }
for (const x of [...base.slice(0, 12), ...others]) for (const y of others) { let r; try { r = compare(x, y); } catch (e) { r = e.name; } say(key(x) + " " + key(y) + " " + r); try { r = x.localeCompare(y, "de"); } catch (e) { r = e.name; } say("" + r); }
for (const x of strings.slice(0, 20)) { let r; try { r = x.localeCompare(); } catch (e) { r = e.name; } say("none " + r); say("two " + x.localeCompare("abc", undefined) + x.localeCompare("ABC", undefined, { sensitivity: "base" }) + x.localeCompare("item2", "en", { numeric: true })); }
const rows = strings.map((name, i) => ({ name, id: (i * 7) % 13 }));
for (let k = 0; k < 4; k++) { say(strings.slice(k * 5).sort(compare).map(s => s.length).join()); say(rows.slice(k).sort(compareRows).map(r => r.id).join()); say(strings.toSorted(down).map(s => s.length).join()); }
const wrapped = [{ localeCompare: () => 7 }, Object.assign(Object.create(String.prototype), { toString: () => "ab" }), new String("ab")];
for (const x of wrapped) say(String(x.localeCompare("abc")));
class Name extends String { localeCompare(y) { return 5; } } say(String(new Name("a").localeCompare("b")));
const borrowed = String.prototype.localeCompare; for (const x of base.slice(0, 12)) say(borrowed.call(x, "ab") + "" + borrowed.call(1, x) + base.map(borrowed, x).join());
console.log("lines", lines, hash);
