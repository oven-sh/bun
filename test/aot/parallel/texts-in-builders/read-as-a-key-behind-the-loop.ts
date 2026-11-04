// the text that has grown in the loop is used as a key behind it: of an object, of a Map, as an index, and as the name of a property that is stored
const table: Record<string, string> = { k0k1k2: "three", "": "empty", "12": "index", length: "own length" };
const map = new Map<string, string>([["k0k1k2", "three in the map"], ["", "empty in the map"]]);
const list = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function named(n: number) { let s = ""; for (let i = 0; i < n; i++) s += "k" + i; return table[s]; }
function mapped(n: number) { let s = ""; for (let i = 0; i < n; i++) s += "k" + i; return map.get(s); }
function indexed(n: number) { let s = ""; for (let i = 1; i <= n; i++) s += i; return list[s as any]; }
function stored(n: number) { const o: Record<string, number> = {}; let s = "p"; for (let i = 0; i < n; i++) s += i; o[s] = n; return Object.keys(o).join() + "=" + o[s]; }
function spelled(word: string) { let s = ""; for (let i = 0; i < word.length; i++) s += word[i]; return table[s]; }
console.log(named(0), named(3), named(2));
console.log(mapped(0), mapped(3), mapped(2));
console.log(indexed(0), indexed(1), indexed(2), indexed(3));
console.log(stored(0), stored(1), stored(4));
console.log(spelled("length"), spelled("12"), spelled("toString") === Object.prototype.toString as any, spelled("nothing"));
