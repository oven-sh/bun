// node:fs's `promises` is found only behind eight classes, each of which is known once the one before it is. By then `either`, which may also be a value nobody knows, has long gone on into unknown hands. Its member is read under a key that is joined at run time, and called.
const name = process.argv[2] ?? ["acc", "ess"].join("");
class Step0 { next() { return new Step1(); } }
class Step1 { next() { return new Step2(); } }
class Step2 { next() { return new Step3(); } }
class Step3 { next() { return new Step4(); } }
class Step4 { next() { return new Step5(); } }
class Step5 { next() { return new Step6(); } }
class Step6 { next() { return new Step7(); } }
class Step7 { next() { return require("node:fs").promises; } }
let found = new Step0();
for (let i = 0; i < 8; i++) found = found.next();
const either = process.argv.length > 7 ? globalThis.source?.() : found;
globalThis.sink?.(either);
console.log(String(either[name]("/")));
