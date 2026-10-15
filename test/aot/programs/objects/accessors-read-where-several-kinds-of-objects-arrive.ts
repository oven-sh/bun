// One place in the program reads the same name from objects of many kinds: literals that mix data members and getters, literals of getters only, plain records, class instances.
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
interface Named { readonly id: string }
function idOf(from: Named): string { return from.id; }
function colorOf(from: any): unknown { return from.color; }

interface Sized extends Named { size: number }
interface Weighed extends Named { weight: number; height: number }
function mixed(id: string): Sized { return { size: 1, get id() { return "mixed " + id; } }; }
function mixedOtherwise(id: string): Weighed { return { weight: 2, height: 3, get id() { return "otherwise " + id; } }; }
function gettersOnly(id: string): Named { return { get id() { return "getter " + id; } }; }
function record(id: string): Named { return { id: "record " + id }; }
class Instance implements Named { constructor(private readonly name: string) {} get id(): string { return "instance " + this.name; } }
class Holder implements Named { id: string; constructor(name: string) { this.id = "holder " + name; } }

const all: Named[] = [mixed("a"), mixedOtherwise("b"), gettersOnly("c"), record("d"), new Instance("e"), new Holder("f")];
let seen = "";
for (let round = 0; round < 200; round++) for (const one of all) { const id = idOf(one); if (round === 199) seen += id + "; "; }
say("six kinds through one place", seen);

const first = all[0] as any;
const second = all[1] as any;
seen = "";
for (let round = 0; round < 200; round++) for (const one of all) { const color = colorOf(one); if (round === 199) seen += String(color) + " "; }
say("a name none of them has", seen);
first.color = "red";
second.color = "blue";
seen = "";
for (let round = 0; round < 200; round++) for (const one of all) { const color = colorOf(one); if (round === 199) seen += String(color) + " "; }
say("two of them have it now", seen);
Object.defineProperty(first, "id", { get() { return "another getter"; }, enumerable: true, configurable: true });
Object.defineProperty(second, "id", { value: "a value", enumerable: true, configurable: true, writable: true });
delete first.color;
seen = "";
for (let round = 0; round < 200; round++) for (const one of all) { const id = idOf(one) + "/" + String(colorOf(one)); if (round === 199) seen += id + "; "; }
say("after changes", seen);

const many: Named[] = [];
for (let i = 0; i < 60; i++) many.push(i % 3 === 0 ? mixed("m" + i) : i % 3 === 1 ? mixedOtherwise("o" + i) : record("r" + i));
let total = 0;
for (let round = 0; round < 30; round++) for (const one of many) total += idOf(one).length;
say("sixty objects of three kinds", total);
let garbage: unknown[] = [];
for (let i = 0; i < 150000; i++) { garbage.push({ i, get twice() { return i * 2; } }); if (garbage.length > 1000) garbage = []; if (i % 50000 === 0) { let now = ""; for (const one of all) now += idOf(one).length + ","; say("while garbage is made", now); } }
console.log(lines.join("\n"));
