// Keys of arrays, strings and typed arrays that are numbers not known to be integers: every kind of number, read and written.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
const list: (string | undefined)[] = []; for (let i = 0; i < 20; i++) list.push("e" + i);
const named = list as unknown as Record<string, string | undefined>;
named["-1"] = "minus one"; named["1.5"] = "one and a half"; named["NaN"] = "not a number"; named["Infinity"] = "infinity"; named["-Infinity"] = "minus infinity"; named["4294967295"] = "two to the 32 less one"; named["4294967296"] = "two to the 32"; named["9007199254740992"] = "two to the 53"; named["1e+21"] = "ten to the 21"; named["5e-324"] = "least"; named["-2147483649"] = "below int32";
const bytes = new Uint8Array(20); for (let i = 0; i < 20; i++) bytes[i] = 100 + i;
const doubles = [0.5, 1.5, 2.5, 3.5];
const text = "abcdefghijklmnopqrst";
class Holder { key = 0.5; }
function read(h: Holder): string { return show(list[h.key]) + "|" + show(bytes[h.key]) + "|" + show(doubles[h.key]) + "|" + show(text[h.key]); }
function readNext(h: Holder): string { return show(list[h.key + 1]) + "|" + show(list[h.key - 1]) + "|" + show(list[h.key * 2]) + "|" + show(list[h.key / 2]); }
function has(h: Holder): string { return (h.key in list) + "|" + (list[h.key] !== undefined) + "|" + Object.prototype.hasOwnProperty.call(list, h.key); }
function write(h: Holder, target: (string | undefined)[], numbers: number[], small: Uint8Array): string { target[h.key] = "w"; numbers[h.key] = 9.5; small[h.key] = 7; return target.length + "|" + numbers.length + "|" + Object.keys(target).slice(-2).join("/") + "|" + Object.keys(numbers).slice(-2).join("/") + "|" + small.join("").length; }
function walk(from: number, to: number): string { let s = ""; for (let at = from; at < to && s.length < 40; at += 1) s += show(list[at]) + ","; return s; }
const keys: number[] = JSON.parse("[0,1,2,3,19,20,21,-1,1.5,0.5,-0.5,-0,2147483647,2147483648,-2147483648,-2147483649,4294967294,4294967295,4294967296,9007199254740992,1e21,5e-324]");
for (const name of JSON.parse('["NaN","Infinity","-Infinity"]') as string[]) keys.push(Number(name));
const holder = new Holder();
for (const key of keys) {
    holder.key = key;
    const big = key > 1000 || key < -1000;
    console.log(show(key), read(holder), readNext(holder), has(holder), big && Number.isInteger(key) && key > 0 && key < 4294967295 ? "(not written: it would make a huge array)" : write(holder, ["a", "b", "c"], [1.5, 2.5], new Uint8Array(4)));
}
console.log(walk(17.0, 22), walk(-2, 1.5), walk(0.5, 3), walk(NaN, 3), walk(18, Infinity));
