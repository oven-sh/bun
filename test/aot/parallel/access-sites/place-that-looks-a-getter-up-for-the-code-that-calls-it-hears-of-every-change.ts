// `flags.n3`, where descriptors lay closures of one function as getters and compiled code calls what the lookup finds: the lookup asks the place of the read. Each place is warmed on its own, then its object changes under a name that the build cannot read, or is collected.
const hidden = JSON.parse('{"define":"defineProperty","below":"setPrototypeOf","freeze":"freeze","n5":"n5"}');
const objects: any = Object;
const names: string[] = [];
for (let i = 0; i < 40; i++) names.push("n" + i);
function getterOf(name: string, weight: number, holder: object) { return function (this: unknown) { return name + ":" + weight + ":" + (this === holder ? "own" : "other"); }; }
function build(weight: number): any { const flags: any = Object.create(null); for (let k = 0; k < names.length; k++) { const name = names[k]; Object.defineProperty(flags, name, { get: getterOf(name, weight, flags), enumerable: true, configurable: true }); } return flags; }
const flagsA = build(1), flagsB = build(2), flagsC = build(3), flagsD = build(4), flagsE = build(5), flagsF = build(6);
let flagsG = build(7);
function readA() { return flagsA.n3; }
function readB() { return flagsB.n17; }
function readC() { return flagsC.n5; }
function readD() { return flagsD.n9; }
function readE() { return flagsE.n39; }
function readF() { return flagsF.n0; }
function readG() { return flagsG.n21; }
function often(read: () => unknown) { let last: unknown; for (let i = 0; i < 400; i++) last = read(); return String(last); }
function log(...parts: unknown[]) { console.log(parts.join(" | ")); }

log("another function: before", often(readA));
objects[hidden.define](flagsA, "n3", { get() { return "another function"; }, configurable: true });
log("another function: behind", readA(), often(readA));
log("a value: before", often(readB));
objects[hidden.define](flagsB, "n17", { value: "a value", configurable: true });
log("a value: behind", readB(), often(readB));
log("deleted: before", often(readC));
delete flagsC[hidden.n5];
log("deleted: behind", readC(), often(readC));
log("another closure of the function: before", often(readD));
objects[hidden.define](flagsD, "n9", { get: getterOf("n9", 90, flagsD), configurable: true });
log("another closure of the function: behind", readD(), often(readD));
log("another prototype: before", often(readE));
objects[hidden.below](flagsE, { more: 1 });
log("another prototype: behind", readE(), often(readE));
log("frozen: before", often(readF));
objects[hidden.freeze](flagsF);
log("frozen: behind", readF(), often(readF));
log("collected: before", often(readG));
for (let round = 0; round < 4; round++) {
  flagsG = build(70 + round);
  (globalThis as any).Bun.gc(true);
  log("collected: behind", readG(), often(readG));
}

export {};
