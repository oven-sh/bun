// Patterns whose text the compiler cannot know, in every use that has a road of its own: exec whose array is kept, exec that is only asked whether it found something, test; with each flag; with no group, some groups,
// more groups than fit a small vector, named groups; on subjects of 8 and 16 bits, ropes and pieces; with a lastIndex that counts, that is no integer, that cannot be written; and what RegExp keeps of the last match.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail as T;
function show(value: unknown): string { return value === null ? "null" : value === undefined ? "undefined" : JSON.stringify(value); }
function whole(m: RegExpExecArray | null): string { return m === null ? "null" : show([m.index, m.input.length, m.length, ...m]) + (m.groups ? show(m.groups) : "") + ((m as any).indices ? show((m as any).indices) : ""); }

const groups = (count: number) => Array.from({ length: count }, (_, i) => "(" + String.fromCharCode(97 + (i % 26)) + ")?").join("");
const sources: [string, string][] = [
  ["^(?:\\/text)(?:\\/$)?$", "i"], ["^(?:\\/users\\/([^\\/]+)\\/posts\\/([^\\/]+))(?:\\/$)?$", "i"], ["a+", ""], ["a+", "g"], ["a+", "y"], ["a+", "gy"], ["(a)|(b)", ""], ["(a)|(b)", "g"], ["^$", ""], ["", ""], ["", "g"], ["$", "m"],
  ["^b", "m"], ["a.c", "s"], ["a.c", ""], ["[^a-c]+", "u"], ["\\p{L}+", "u"], ["(?<first>\\w)(?<second>\\w)?", ""], ["(\\w)(\\w)", "d"], [groups(3), ""], [groups(15), ""], [groups(16), ""], [groups(40), ""],
  ["abc", ""], ["b", ""], ["\\/posts", ""], ["aaa \\/text", ""], ["α", ""], ["abc", "g"],
  ["(?<=a)b", ""], ["(a)\\1", "i"], ["(a)\\1", "iu"], ["\\bab\\b", "iu"], ["x{3,}", ""], ["longer than the subject can ever be, by far", ""], ["α+", ""], ["[α-ω]+", "i"], ["(?:a|ab)(?:c|bcd)(?:d*)", ""], ["(a*)*b", ""], ["(?=(a+))a*b\\1", ""],
];
const flat: string[] = hide(["", "a", "/text", "/TEXT/", "/users/42/posts/hello", "/users//posts/x", "aaa baa", "abc a\nc", "b\nb", "abcabc", "aab", "baaab aa", "xxxx", "αβγ aα", "ab", "abcd", "abcdefghijklmnopqrstuvwxyz"]);
const head: string = hide("/users/42"), tail: string = hide("/posts/hello"), long: string = hide("0123456789 aaa /text abc abcd αβγ and a tail that is long enough to stay a piece");
const narrow: string = hide("0123456789 aaa /text abc abcd /users/42/posts/hello b aab and a tail that is long enough for a piece of it to stay a piece");
const subjects: (() => string)[] = [...flat.map(text => () => text), () => head + tail, () => hide("a") + hide("ab") + hide("c"), () => long.slice(11, 40), () => long.slice(15, 20), () => long.slice(30, 50),
  () => narrow.slice(11, 40), () => narrow.slice(15, 20), () => narrow.slice(30, 51), () => narrow.slice(52, 90), () => narrow.slice(3, 100)];

for (const [source, flags] of sources) {
  const pattern = new RegExp(hide(source), hide(flags));
  const row: string[] = [];
  for (const subject of subjects) {
    pattern.lastIndex = 0;
    const kept = pattern.exec(subject());
    row.push(whole(kept), String(pattern.lastIndex), show(RegExp.lastMatch), show(RegExp.$1), show(RegExp.$2));
    const again = pattern.exec(subject()); row.push(whole(again), String(pattern.lastIndex));
    pattern.lastIndex = 0; let found = 0; if (pattern.exec(subject())) found++; if (pattern.exec(subject()) !== null) found += 2; row.push(String(found), String(pattern.lastIndex));
    pattern.lastIndex = 0; row.push(String(pattern.test(subject())), String(pattern.lastIndex), String(pattern.test(subject())), String(pattern.lastIndex));
    pattern.lastIndex = 2; row.push(whole(pattern.exec(subject())), String(pattern.lastIndex));
    (pattern as any).lastIndex = 1.5; row.push(whole(pattern.exec(subject())), String(pattern.lastIndex));
    (pattern as any).lastIndex = "1"; row.push(String(pattern.test(subject())), show(pattern.lastIndex));
    (pattern as any).lastIndex = -1; row.push(whole(pattern.exec(subject())), String(pattern.lastIndex));
    pattern.lastIndex = 1000; row.push(whole(pattern.exec(subject())), String(pattern.lastIndex));
  }
  lines.push("/" + source.slice(0, 24) + "/" + flags + ": " + row.join(" "));
}

{
  const sealed = new RegExp(hide("a"), hide("g")); Object.defineProperty(sealed, "lastIndex", { writable: false, value: 0 });
  for (const text of ["a", "b"]) { try { lines.push("read-only lastIndex, " + text + ": " + whole(sealed.exec(hide(text)))); } catch (error) { lines.push("read-only lastIndex, " + text + ": " + (error as Error).constructor.name); } }
  const plain = new RegExp(hide("a"), hide("")); Object.defineProperty(plain, "lastIndex", { writable: false, value: 7 });
  lines.push("read-only lastIndex without g: " + whole(plain.exec(hide("ba"))) + " " + plain.test(hide("b")) + " " + plain.lastIndex);
  let asked = 0; const watched = new RegExp(hide("a"), hide("")); (watched as any).lastIndex = { valueOf() { asked++; return 0; } };
  lines.push("lastIndex that is an object: " + whole(watched.exec(hide("ba"))) + " " + watched.test(hide("a")) + " " + asked);
  class Mine extends RegExp { override exec(text: string) { lines.push("my exec " + text); return super.exec(text); } }
  const mine = new Mine(hide("a+")); lines.push("a subclass: " + mine.test(hide("caab")) + " " + whole(mine.exec(hide("caab"))) + " " + "caab".replace(mine, "_"));
  const own = new RegExp(hide("a+")); (own as any).exec = () => null; lines.push("an exec of its own: " + own.test(hide("aa")) + " " + show(RegExp.prototype.exec.call(own, hide("baa"))));
  const compiled = new RegExp(hide("a")); lines.push("before compile: " + whole(compiled.exec(hide("ab")))); (compiled as any).compile(hide("b"), hide("")); lines.push("after compile: " + whole(compiled.exec(hide("ab"))));
}

let count = 0;
const rounds = Number(process.argv[2] ?? 300);
const routes = ["/text", "/json", "/users/:id"].map(path => new RegExp(hide("^(?:" + path.replace(/\//g, "\\/").replace(/:\w+/, "([^\\/]+)") + ")(?:\\/$)?$"), "i"));
for (let i = 0; i < rounds; i++) for (const route of routes) { const m = route.exec(i & 1 ? "/users/" + i : "/json"); if (m) count += m.length + m[0]!.length; }
lines.push("count " + count);
console.log(lines.join("\n"));
