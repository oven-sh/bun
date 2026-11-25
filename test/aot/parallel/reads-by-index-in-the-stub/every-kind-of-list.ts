function at(list: any, index: any) { return list[index]; }
function twice(list: any, index: any) { const first = list[index]; const second = list[index]; return first === second || (first !== first && second !== second) ? first : "differs"; }
(globalThis as any).shown = [at, twice];
const holey: any[] = ["a", , "c"];
const grown: any[] = []; for (let step = 0; step < 5; step++) grown.push({ step });
const numbers = [1, 2, 3]; const halves = [0.5, 1.5, NaN]; const texts = ["x", "y"]; const mixed: any[] = [1, "two", { three: 3 }, null, undefined, true];
const written = ["p", "q"]; written[1] = "r";
const likeList: any = { 0: "zero", 1: "one", length: 2 };
const sparse: any[] = []; sparse[100000] = "far";
const frozen = Object.freeze(["f", "g"]); const sealed = Object.seal([{ s: 1 }, { s: 2 }]);
const withName: any = ["n"]; withName.extra = "name"; withName["-1"] = "minus";
class Below extends Array<any> {} const below = new Below(); below.push("b0", "b1");
const inherits: any[] = ["own", , "own2"]; Object.setPrototypeOf(inherits, { __proto__: Array.prototype, 1: "from above" });
function args(..._all: any[]) { return arguments; }
const lists: any[] = [holey, grown, numbers, halves, texts, mixed, written, likeList, sparse, frozen, sealed, withName, below, inherits, args("a0", "a1"), "text", new Uint8Array([7, 8]), new Float64Array([0.25]), new Map(), 5, true, Symbol.iterator];
const indexes: any[] = [0, 1, 2, 3, -1, 1.0, 1.5, "1", "extra", 100000, 4294967295, 2147483648, -0, NaN];
const said: string[] = [];
for (let turn = 0; turn < 3; turn++) for (const list of lists) for (const index of indexes) {
    const found = at(list, index), again = twice(list, index);
    said.push(typeof found === "object" && found ? JSON.stringify(found) : String(found), typeof again === "object" && again ? JSON.stringify(again) : String(again));
}
console.log(said.length, said.join("|"));
for (const nothing of [undefined, null]) { try { at(nothing, 0); } catch (error) { console.log((error as Error).constructor.name); } }
