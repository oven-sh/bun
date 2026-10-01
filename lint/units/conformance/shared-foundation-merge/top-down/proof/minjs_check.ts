// hasMinJsSuffix of vfsmatch.go cuts by bytes and then folds: the port of the upper prototype as it is, and with a guard, against Go.
// usage: copy minjs_main.go.txt to main.go beside a go.mod, go build, run it into a file, then bun minjs_check.ts <that file>
import { equalFold, isAscii } from "../runner/gostrings";
const go: Record<string, boolean> = JSON.parse(await Bun.file(process.argv[2]).text());
const minJs = ".min.js";
const asIs = (f: string) => f.length >= minJs.length && equalFold(f.slice(f.length - minJs.length), minJs);
const guarded = (f: string) => {
  if (f.length < minJs.length) return false;
  const tail = f.slice(f.length - minJs.length);
  return isAscii(tail) && equalFold(tail, minJs);
};
let a = 0, g = 0;
for (const [s, want] of Object.entries(go)) {
  if (asIs(s) !== want) { a++; console.log("the port as it is differs:", JSON.stringify(s), "Go", want); }
  if (guarded(s) !== want) { g++; console.log("the guarded form differs:", JSON.stringify(s), "Go", want); }
}
console.log(JSON.stringify({ inputs: Object.keys(go).length, asItIsDiffers: a, guardedDiffers: g }));
