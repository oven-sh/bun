// Under: --aot-harden=proof-checks: a field born undefined, without room, is taken away and laid again under a key that nobody knows: it exists where the order of the names lists it, and nowhere else
const flags = Symbol("flags");
class Holder {
    [flags]: number = 4; bits: number; early?: object; late?: object; last: number;
    constructor(bits: number) { this.bits = bits; this.early = undefined; this.late = undefined; this.last = bits + 1; }
}
function make(bits: any) { return new Holder(bits); }
const keysOf = (holder: object): PropertyKey[] => [...Object.getOwnPropertySymbols(holder), ...Object.keys(holder)];
const told = (holder: Holder) => keysOf(holder).map(String).join() + " | " + JSON.stringify(holder) + " | " + ("early" in holder) + " " + Object.hasOwn(holder, "late") + " " + String(holder.early) + " " + String(holder.late);
const given: any[] = JSON.parse('[4,5,6]'), laid: any[] = [undefined, { n: 1 }, undefined];
for (let turn = 0; turn < 3; turn++)
  for (const at of [0, 1, 2, 3, 4]) {
    const holder = make(given[turn]);
    const key = keysOf(holder)[at];
    delete (holder as any)[key];
    console.log("SAID taken", at, told(holder));
    (holder as any)[key] = laid[turn];
    console.log("SAID laid", at, told(holder));
    holder.late = undefined; holder.early = undefined;
    console.log("SAID emptied", at, told(holder));
    holder.early = given; delete (holder as any)[key]; (holder as any)[key] = undefined;
    console.log("SAID again", at, told(holder));
  }
