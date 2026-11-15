function kind(text: string): number {
  switch (text) {
    case "GET": return 1; case "HEAD": return 2; case "PUT": return 3; case "POST": return 4; case "DELETE": return 5; case "PATCH": return 6; case "OPTIONS": return 7;
    case "a": return 8; case "b": return 9; case "": return 10; case "a-text-that-is-longer-than-sixteen-characters": return 11; case "a-text-that-is-longer-than-sixteen-letterssss": return 12;
    default: return 0;
  }
}
function wide(text: string): number {
  switch (text) { case "é": return 1; case "日本": return 2; case "GET": return 3; case "abc日": return 4; case "ÿ": return 5; case "xyz": return 6; default: return 0; }
}
const long = "q".repeat(130), other = "r".repeat(130);
function veryLong(text: string): number {
  switch (text) {
    case "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq": return 1;
    case "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr": return 2;
    case "s": return 3; default: return 0;
  }
}
const words = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS", "GEX", "PUX", "POSX", "a", "b", "c", "", "OPTIONX", "DELETF", "a-text-that-is-longer-than-sixteen-characters", "a-text-that-is-longer-than-sixteen-letterssss", "a-text-that-is-longer-than-sixteen-charactert", "é", "日本", "abc日", "ÿ", "xyz", "日", "abc", "日本語", long, other, long.slice(1), "s"];
const bases = [words.join(" ") + " narrow?", "narrow " + words.filter(w => [...w].every(c => c.charCodeAt(0) < 256)).join(" "), "日" + words.join(" ")];
const made: string[] = [];
for (const w of words) {
  made.push(w, w.slice(0, 1) + w.slice(1), (w + "!").slice(0, -1), ("!" + w).slice(1), ("日" + w).slice(1), [...w].join(""), w.toUpperCase(), `${w}`);
  for (const base of bases) { const at = base.indexOf(w); if (at >= 0) made.push(base.slice(at, at + w.length), base.substring(at, at + w.length + 1), base.substr(at, w.length)); }
}
for (const base of bases) made.push(...base.split(" "));
const opened: any[] = made.concat([1, null, undefined, {}, "GET".split("")] as any);
let text = "";
for (let round = 0; round < 3; round++) {
  for (const item of opened) text += kind(item).toString(36) + wide(item) + veryLong(item);
  for (let i = 0; i < opened.length; i++) {
    switch (opened[i]) { case "GET": text += "g"; break; case "POST": text += "p"; break; case "日本": text += "j"; break; case "OPTIONS": text += "o"; break; case "xyz": text += "x"; break; default: text += "."; }
    switch (opened[i]) { case "GET": text += "G"; break; case "PUT": text += "U"; break; case "a": text += "A"; break; default: text += "-"; }
  }
}
// the base of a substring lives by the substring alone
let kept: string[] = [];
for (let i = 0; i < 2000; i++) { const base = "x".repeat(20 + (i % 50)) + "OPTIONS" + i; kept.push(base.slice(20 + (i % 50), 27 + (i % 50))); }
Bun.gc(true);
let options = 0;
for (const k of kept) options += kind(k);
console.log(text, options);
