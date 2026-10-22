// typed-calls.ts <seed> <paths>: every function of node:path called with operands the compiler can prove to be strings, in the forms a JS string has. One line a call.
// Compiled ahead of time and under `bun run` it prints the same.
import path from "node:path";

const [seedText = "1", countText = "2000"] = process.argv.slice(2);
let state: number = Number(seedText) >>> 0 || 1;
function random(below: number): number {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state % below;
}
const names: string[] = ["", ".", "..", "...", "a", "ab", "index.ts", "package.json", ".bin", "e.", "f..g", "x.tar.gz", "node_modules", "src", "é", "ñandú.txt", "日本.語", "a-rather-long-name-of-a-folder-that-has-more-than-thirty-two-characters", "sixteen-letters!", "eight-ch"];
const separators: string[] = ["/", "/", "/", "//", "/./", "/../"];
const starts: string[] = ["", "", "/", "/", "//", "./", "../"];
const ends: string[] = ["", "", "", "/", "//", "/.", "/..", "."];
function pick(list: string[]): string {
  return list[random(list.length)];
}
function makePath(): string {
  let text: string = pick(starts);
  for (let parts = random(7); parts > 0; --parts) text += pick(names) + (parts > 1 ? pick(separators) : "");
  return text + pick(ends);
}
function flat(text: string): string {
  text.charCodeAt(0);
  return text;
}
function inForm(form: number, text: string): string {
  if (form === 0) return flat(text);
  if (form === 1) return text.length < 2 ? text : flat(text.slice(0, text.length >> 1) + "") + text.slice(text.length >> 1);
  if (form === 2) return flat("<<" + text + ">>>").slice(2, -3);
  return flat("日" + text + "本").slice(1, -1);
}

const lines: string[] = [];
function say(label: string, answer: string): void {
  lines.push(label + " " + JSON.stringify(answer));
  if (lines.length >= 4096) {
    console.log(lines.join("\n"));
    lines.length = 0;
  }
}
const count: number = Number(countText);
for (let i = 0; i < count; ++i) {
  const a: string = makePath();
  const b: string = makePath();
  const c: string = makePath();
  const form: number = i & 3;
  const other: number = random(4);
  const label: string = i + " " + form + " " + other + " " + JSON.stringify([a, b, c]);
  say(label + " basename", path.basename(inForm(form, a)));
  say(label + " basename suffix", path.basename(inForm(form, a), inForm(other, a.slice(-random(6)))));
  say(label + " basename .ts", path.basename(inForm(form, a), ".ts"));
  say(label + " dirname", path.dirname(inForm(form, a)));
  say(label + " extname", path.extname(inForm(form, a)));
  say(label + " isAbsolute", String(path.isAbsolute(inForm(form, a))));
  say(label + " normalize", path.normalize(inForm(form, a)));
  const parsed = path.parse(inForm(form, a));
  say(label + " parse", parsed.root + "|" + parsed.dir + "|" + parsed.base + "|" + parsed.ext + "|" + parsed.name);
  say(label + " format", path.format(parsed));
  say(label + " toNamespacedPath", path.toNamespacedPath(inForm(form, a)));
  say(label + " join1", path.join(inForm(form, a)));
  say(label + " join2", path.join(inForm(form, a), inForm(other, b)));
  say(label + " join3", path.join(inForm(form, a), inForm(other, b), inForm(form, c)));
  say(label + " join0", path.join());
  say(label + " resolve1", path.resolve(inForm(form, a)));
  say(label + " resolve2", path.resolve(inForm(form, a), inForm(other, b)));
  say(label + " resolve3", path.resolve(inForm(form, a), inForm(other, b), inForm(form, c)));
  say(label + " resolve0", path.resolve());
  say(label + " relative", path.relative(inForm(form, a), inForm(other, b)));
  say(label + " relative inside", path.relative(inForm(form, a), inForm(other, a + "/" + b)));
  say(label + " relative outside", path.relative(inForm(form, a + "/" + b), inForm(other, a)));
  say(label + " dirname dirname", path.dirname(path.dirname(inForm(form, a))));
  say(label + " join of parts", path.join(path.dirname(inForm(form, a)), path.basename(inForm(form, a))));
  say(label + " win32", path.win32.join(inForm(form, a), inForm(other, b)) + "|" + path.win32.dirname(inForm(form, a)) + "|" + path.win32.basename(inForm(form, a)) + "|" + path.win32.normalize(inForm(form, a)));
}
console.log(lines.join("\n"));
