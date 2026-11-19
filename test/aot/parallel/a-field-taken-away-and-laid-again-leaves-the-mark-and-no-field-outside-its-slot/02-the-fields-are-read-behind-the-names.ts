// Under: --aot-harden=proof-checks: the fields are read, added to and listed behind the names
const flags = Symbol("flags"), level = Symbol("level");
class Holder { [flags]: number = 4; [level]: number = 1; bits: number = 4; }
const keysOf = (holder: object): PropertyKey[] => [...Object.getOwnPropertySymbols(holder), ...Object.keys(holder)];
for (let turn = 0; turn < 3; turn++)
  for (const at of [0, 1, 2]) {
    const holder = new Holder();
    const key = keysOf(holder)[at];
    delete (holder as any)[key];
    console.log("SAID taken", at, keysOf(holder).map(String).join(), holder.bits, holder[flags], holder[level], "bits" in holder, flags in holder);
    (holder as any)[key] = 6;
    console.log("SAID laid", at, keysOf(holder).map(String).join(), holder.bits, holder[flags], holder[level], "bits" in holder, JSON.stringify(Object.getOwnPropertyDescriptor(holder, "bits")));
    holder.bits += 1; holder[level] += 2;
    console.log("SAID added", at, keysOf(holder).map(String).join(), holder.bits + holder[flags] + holder[level], JSON.stringify(holder), Object.values(holder).join());
  }
