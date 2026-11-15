// Callbacks that call methods of strings on elements of which nothing is known, or that take no element at all.
const seen = [];
const say = v => typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "function" : Array.isArray(v) ? "[" + Array.from(v, (x, i) => i in v ? say(x) : "hole").join() + "]" : typeof v === "object" && v ? "object" : String(v);
function starting(list) { return list.filter(x => x.startsWith("a")); }
function trimmed(list) { return list.map(x => x.trim()); }
function upper(list) { return list.map(x => x.toUpperCase()); }
function first(list) { return list.map(x => x.charCodeAt(0)); }
function padded(list) { return list.map(x => x.padStart(4, "-")); }
function ending(list) { return list.some(x => x.endsWith("b")); }
function lower(list) { return list.find(x => x.toLowerCase() === "ab"); }
function twice(list) { return list.map(x => x.trim().toUpperCase()); }
function marked(list) { return list.map(x => x.toLowerCase() + "!"); }
function every(list) { return list.filter((x, i) => i % 2 === 0); }
function positions(list) { return list.map((x, i) => i * 2); }
function held(list) { return list.map(x => [x]); }
function same(list) { return list.map(x => x); }
const json = v => JSON.parse(JSON.stringify(v));
const lists = () => [[], json(["a", " ab ", "b", "Ab"]), json([]), json(Array.from({ length: 40 }, (_, i) => (i % 3 ? "a" : "B") + i)), json(["a", 5, "b"]), ["a", new String("ab"), "b"], ["a", , "b"], [null], ["éa", "😀", ""],
    [{ trim() { seen.push("trim"); return "own"; }, toUpperCase() { seen.push("upper"); return "U"; }, startsWith() { seen.push("starts"); return true; }, charCodeAt: () => 7 }], [1, 2, 3], [["a"], ["b"]], [Symbol.iterator], [1n], Object.freeze(["a", "b"]), new Proxy(["a", "b"], { get(target, key) { seen.push(String(key)); return target[key]; } })];
function once(list) {
    let said = "";
    for (let f = 0; f < 13; f++) {
        let result;
        try {
            switch (f) {
            case 0: result = starting(list); break;
            case 1: result = trimmed(list); break;
            case 2: result = upper(list); break;
            case 3: result = first(list); break;
            case 4: result = padded(list); break;
            case 5: result = ending(list); break;
            case 6: result = lower(list); break;
            case 7: result = twice(list); break;
            case 8: result = marked(list); break;
            case 9: result = every(list); break;
            case 10: result = positions(list); break;
            case 11: result = held(list); break;
            case 12: result = same(list); break;
            }
            said += say(result) + " ";
        } catch (e) { said += e.constructor.name + " "; }
        said += seen.join() + " ";
        seen.length = 0;
    }
    return said;
}
for (let turn = 0; turn < 3; turn++) for (const [k, list] of lists().entries()) console.log(k, once(list));
