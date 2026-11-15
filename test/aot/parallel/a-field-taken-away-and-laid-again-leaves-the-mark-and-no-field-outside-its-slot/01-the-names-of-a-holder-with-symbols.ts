// Under: --aot-harden=proof-checks: the last name taken away and laid again: the order of the names is the order of birth again, the cell still bears the mark, no field lies outside its slot
const flags = Symbol("flags"), level = Symbol("level");
class Holder { [flags]: number = 4; [level]: number = 1; bits: number = 4; }
const keysOf = (holder: object): PropertyKey[] => [...Object.getOwnPropertySymbols(holder), ...Object.keys(holder)];
for (let turn = 0; turn < 3; turn++)
  for (const at of [0, 1, 2]) {
    const holder = new Holder();
    const key = keysOf(holder)[at];
    delete (holder as any)[key];
    console.log("SAID taken", at, keysOf(holder).map(String).join());
    (holder as any)[key] = 6;
    console.log("SAID laid", at, keysOf(holder).map(String).join());
  }
