// A Set and the keys of a Map keep +0 where -0 went in, and know one NaN. A hole of a list is handed out as undefined. What a loop hands out is computed with at once, typed and untyped.
const box: any = {}; (globalThis as any).box = box;
const show = (value: unknown) => Object.is(value, -0) ? "-0" : String(value);
function typedKeys(map: Map<number, number>) { const out: string[] = []; for (const key of map.keys()) out.push(show(key), show(1 / key), show(key + 1), String(key === 0), String(Object.is(key, 0))); return out.join(); }
function typedValues(map: Map<number, number>) { const out: string[] = []; for (const value of map.values()) out.push(show(value), show(1 / value), show(value + 1), String(value === 0)); return out.join(); }
function typedEntries(map: Map<number, number>) { const out: string[] = []; for (const [key, value] of map.entries()) out.push(show(1 / key), show(1 / value)); for (const [key, value] of map) out.push(show(1 / key), show(1 / value)); return out.join(); }
function typedMembers(set: Set<number>) { const out: string[] = []; for (const value of set.values()) out.push(show(1 / value), show(value + 1)); for (const value of set.keys()) out.push(show(1 / value)); for (const [one, two] of set.entries()) out.push(show(1 / one), show(1 / two)); for (const value of set) out.push(show(1 / value)); return out.join(); }
const map = new Map<number, number>([[-0, -0]]); map.set(NaN, NaN); map.set(0 / -1, -0); map.set(NaN, 0 * -1); map.set(1.5, -1.5);
const set = new Set<number>([-0, NaN, NaN, 0, -0 * 1, 2.5]); set.add(-0); set.add(0 / -5);
console.log(typedKeys(map)); console.log(typedValues(map)); console.log(typedEntries(map)); console.log(typedMembers(set), map.size, set.size);
const only = new Set([-0]); for (const value of only.values()) console.log(show(value), show(1 / value), show(value + 1), value === 0);
const keyed = new Map([[-0, "zero"]]); for (const key of keyed.keys()) console.log(show(key), show(1 / key), show(key + 1), key === 0);
box.map = map; box.set = set; box.keys = map.keys(); box.values = map.values(); box.entries = map.entries(); box.members = set.values();
for (const name of ["map", "set", "keys", "values", "entries", "members"]) { const out: string[] = []; for (const value of box[name]) out.push(Array.isArray(value) ? value.map((part: number) => show(1 / part)).join("/") : show(1 / value)); console.log(name, out.join()); }
const holes: (number | undefined)[] = [1, , 3]; holes.length = 5;
function overHoles(list: (number | undefined)[]) { const out: string[] = []; for (const value of list.values()) out.push(String(value), typeof value); for (const [index, value] of list.entries()) out.push(index + ":" + value); for (const index of list.keys()) out.push(String(index in list)); return out.join(); }
console.log(overHoles(holes)); box.holes = holes.values(); { const out: string[] = []; for (const value of box.holes) out.push(String(value)); console.log(out.join()); }
const texts = new Map<string | number, number>([["1", 1], [1, 2], ["01", 3]]); for (const key of texts.keys()) console.log(typeof key, key, texts.get(key));
const whole = new Set<number>([2 ** 31, -(2 ** 31) - 1, 2 ** 53, 4294967296, 0.1 + 0.2]); let sum = 0; for (const value of whole.values()) sum += value; console.log(sum);
