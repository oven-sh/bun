// A written pattern is handed to methods of texts, of other objects, and kept; each evaluation is a pattern of its own.
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail as T;
const kept: RegExp[] = [];
const taker = { replace(pattern: RegExp, with_: string) { kept.push(pattern); pattern.lastIndex = 3; return with_ + pattern.source; }, split(pattern: RegExp) { kept.push(pattern); return [pattern.flags]; } };
function run(subject: { replace(pattern: RegExp, with_: string): string; split(pattern: RegExp): string[] }): string {
  return subject.replace(/a+/g, "-") + "|" + subject.split(/,/).join("+");
}
for (let turn = 0; turn < 3; turn++) console.log(run("baaad,aa"), run(hide(taker)), run(hide("caab,a")), run(taker));
console.log(kept.length, new Set(kept).size, kept.map(pattern => pattern.lastIndex).join());
