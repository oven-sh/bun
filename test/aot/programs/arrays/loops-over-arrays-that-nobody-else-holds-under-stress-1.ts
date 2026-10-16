// The array that map, filter and the like go over may be held by nobody but the loop itself, and the callback may allocate: what the array holds has to outlive every collection until the loop has read it.
export { };
function make(n: number): string[] { const out: string[] = []; for (let i = 0; i < 7; i++) out.push("s" + (n + i)); return out; }
function boxes(n: number): { text: string }[] { const out: { text: string }[] = []; for (let i = 0; i < 7; i++) out.push({ text: "b" + (n + i) }); return out; }
function matched(n: number): string[] { return ("x 1,2;3,4;5;6,7,8;" + n + ";").match(/\d+(?:,\d+)*;/g) ?? []; }
function groups(n: number): string[] { return ("k" + n + "=v" + n + ";").match(/(\w+)=(\w+);/) ?? []; }
function parts(n: number): string[] { return ("ab,cd,ef,gh,ij,kl" + n).split(","); }
const makers: ((n: number) => string[])[] = [make, matched, groups, parts];
function mapped(a: (n: number) => string[], n: number): string { return a(n).map((c: string): string => "<" + c + ">").join(""); }
function filtered(a: (n: number) => string[], n: number): string { return a(n).filter((c: string): boolean => ("x" + c + "y").length > 3).join(""); }
function visited(a: (n: number) => string[], n: number): string { let s = ""; a(n).forEach((c: string): void => { s = s + "[" + c + "]"; }); return s; }
function some(a: (n: number) => string[], n: number): boolean { return a(n).some((c: string): boolean => ("x" + c + "y") === "never"); }
function every(a: (n: number) => string[], n: number): boolean { return a(n).every((c: string): boolean => ("x" + c + "y") !== "never"); }
function found(a: (n: number) => string[], n: number): string { return a(n).find((c: string): boolean => ("x" + c + "y") === "never") ?? "none"; }
function foundLast(a: (n: number) => string[], n: number): string { return a(n).findLast((c: string): boolean => ("x" + c + "y") === "never") ?? "none"; }
function index(a: (n: number) => string[], n: number): number { return a(n).findIndex((c: string): boolean => ("x" + c + "y") === "never"); }
function lastIndex(a: (n: number) => string[], n: number): number { return a(n).findLastIndex((c: string): boolean => ("x" + c + "y") === "never"); }
function reduced(a: (n: number) => string[], n: number): string { return a(n).reduce((s: string, c: string): string => s + "(" + c + ")", ""); }
function reducedRight(a: (n: number) => string[], n: number): string { return a(n).reduceRight((s: string, c: string): string => s + "(" + c + ")", ""); }
function reducedBare(a: (n: number) => string[], n: number): string { return a(n).reduce((s: string, c: string): string => s + "+" + c); }
function flat(a: (n: number) => string[], n: number): string { return a(n).flatMap((c: string): string[] => [c + "!", "?" + c]).join(""); }
function sorted(a: (n: number) => string[], n: number): string { return a(n).sort((x: string, y: string): number => ("k" + x) < ("k" + y) ? 1 : -1).join(""); }
function copied(a: (n: number) => string[], n: number): string { return Array.from(a(n), (c: string): string => "{" + c + "}").join(""); }
function ofBoxes(n: number): string { return boxes(n).map((b: { text: string }): string => "<" + b.text + ">").join("") + boxes(n).filter((b: { text: string }): boolean => ("x" + b.text).length > 2).map((b: { text: string }): string => b.text + ".").join(""); }
let digest = 0;
function note(text: string): void { for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0; }
let last = "";
for (let round = 0; round < 12; round++) {
    for (const a of makers) {
        last = [mapped(a, round), filtered(a, round), visited(a, round), some(a, round), every(a, round), found(a, round), foundLast(a, round), index(a, round), lastIndex(a, round), reduced(a, round), reducedRight(a, round), reducedBare(a, round), flat(a, round), sorted(a, round), copied(a, round)].join(" ");
        note(last);
    }
    note(ofBoxes(round));
}
console.log(last);
console.log(digest);
