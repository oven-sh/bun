// What comes straight out of `n > 0 ? "hex" : "dec"` is the key of a Map, a member of a Set and the name of a property. Each is then asked with ropes, and containers that ropes have filled are asked with it.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a join of written texts
function pick(n: number) { return n > 0 ? "hex" : "dec"; }
const parts = JSON.parse('["he","x","de","c"]') as string[];
const hex = () => parts[0] + parts[1];
const dec = () => parts[2] + parts[3];
const lines: string[] = [];
const map = new Map<string, number>();
const set = new Set<string>();
const record: Record<string, number> = {};
for (let n = 0; n < 4; n++) {
  map.set(pick(n % 2), n);
  set.add(pick(n % 2));
  record[pick(n % 2)] = n;
}
lines.push([map.size, map.get(hex()), map.get(dec()), map.has(hex() + ""), set.size, set.has(hex()), set.has(dec()), record[hex()], record[dec()], Object.keys(record).join("|")].join());
const filled = new Map<string, string>([[hex(), "rope hex"], [dec(), "rope dec"]]);
const members = new Set<string>([hex()]);
const named: Record<string, string> = { [hex()]: "h", [dec()]: "d" };
lines.push([filled.get(pick(1)), filled.get(pick(0)), members.has(pick(1)), members.has(pick(0)), named[pick(1)], named[pick(0)], pick(1) in named, Object.hasOwn(named, pick(0))].join());
filled.delete(pick(1));
members.delete(pick(1));
delete named[pick(1)];
lines.push([filled.size, members.size, Object.keys(named).join("|"), [...map.keys()].map(key => key === hex() || key === dec()).join("|")].join());
const weak = new Map<unknown, number>([[pick(1), 1], [new String(pick(1)), 2]]);
lines.push(String(weak.size), String(weak.get(hex())));
console.log(lines.join("\n"));
