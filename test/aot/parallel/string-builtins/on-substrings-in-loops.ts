// String builtins in loops over strings made in every way: flat, concatenated, substrings of 8-bit and 16-bit bases. A host-free twin answers for each.
const texts = ["", "0", "7", "42", "-13", "+5", " 99 ", "0x1f", "12abc", "abc", "123456789", "1234567890", "00012", "9007199254740993", "1e3", "  trimmed  ", "\ttab\n", "no-trim", "é12", "日本7", "é", " é ", "x ", " y", "﻿8", "/api/users/17", "GET /api/users/17 HTTP/1.1", "a,b,,c", "ÿ/ÿ", "ĀĀ/", "q".repeat(40) + "/" + "r".repeat(40), "/".repeat(9)];
const narrow = texts.filter(t => [...t].every(c => c.charCodeAt(0) < 256));
const bases = ["<" + texts.join("|") + ">", "<" + narrow.join("|") + ">"];
const ways: string[][] = [texts];
for (const base of bases) ways.push(base.slice(1, -1).split("|"), texts.map(t => { const at = base.indexOf("|" + t + "|"); return at < 0 ? t : base.slice(at + 1, at + 1 + t.length); }), base.split("").slice(0, 30));
ways.push(texts.map(t => t.slice(0, 1) + t.slice(1)), texts.map(t => ("!" + t).slice(1)), texts.map(t => ("日" + t + "本").slice(1, -1)), texts.map(t => (t + t).substring(0, t.length)), texts.map(t => ("<<" + t + ">>").slice(1, -1).slice(1, -1)));
const sought = ["", "/", "a", "api", "/api/", "é", "日", "1", "17", "HTTP", "ÿ", "Ā", "q".repeat(17), "users/17 HTTP/1.1", "|", " "];
const seps = sought.concat(sought.map(s => ("<" + s + ">").slice(1, -1)));
let check = 0, lines = 0;
function add(n: number | boolean | string): void {
  const text = String(n);
  for (let i = 0; i < text.length; i++) check = (Math.imul(check, 31) + text.charCodeAt(i)) | 0;
  lines++;
}
for (const list of ways) {
  for (let round = 0; round < 2; round++) {
    for (const t of list) {
      add(parseInt(t)); add(parseInt(t, 10)); add(parseInt(t, 16)); add(Number(t)); add(parseFloat(t)); add(+t);
      add(t.trim()); add(t.trimStart()); add(t.trimEnd()); add(t.length);
      add(t.indexOf("/")); add(t.indexOf("/", 3)); add(t.lastIndexOf("/")); add(t.lastIndexOf("/", 2)); add(t.indexOf("é")); add(t.indexOf("日")); add(t.indexOf(" ", -4)); add(t.indexOf("1", 1e9));
      add(t.includes("/api/")); add(t.startsWith("/")); add(t.startsWith("GET")); add(t.endsWith("7")); add(t.endsWith("1.1")); add(t.startsWith("api", 1)); add(t.endsWith("api", 4));
      add(t.charCodeAt(0)); add(t.codePointAt(1) ?? -1); add(t.at(-1) ?? "none"); add(t[2] ?? "none"); add(t === "42"); add(t < "5"); add(t.toLowerCase()); add(t.toUpperCase());
    }
    for (const t of list) for (const s of seps) {
      add(t.indexOf(s)); add(t.lastIndexOf(s)); add(t.includes(s)); add(t.startsWith(s)); add(t.endsWith(s)); add(t.indexOf(s, 2)); add(t.startsWith(s, 2)); add(t.endsWith(s, 5)); add(t === s);
    }
  }
}
// opened: what comes in is not always a string
const opened: any[] = ["17", "x17y".slice(1, 3), 17, null, undefined, { toString: () => "19" }, ["21"], true, 2n, new String("23")];
for (let round = 0; round < 3; round++) for (const item of opened) { add(parseInt(item)); add(parseInt(item, 8)); try { add(item.indexOf("1")); } catch (e) { add((e as Error).name); } try { add(item.trim()); } catch (e) { add((e as Error).name); } try { add(item.startsWith("1")); } catch (e) { add((e as Error).name); } }
console.log(lines, check);
