// Callbacks that reckon with elements of which nothing is known, or compare them.
const seen = [];
const say = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "symbol" : Array.isArray(v) ? "[" + Array.from(v, (x, i) => i in v ? say(x) : "hole").join() + "]" : typeof v === "object" && v ? "object" : String(v);
function doubled(list) { return list.map(x => x * 2); }
function next(list) { return list.map(x => x + 1); }
function halves(list) { if (!list.length) return list; return list.map(x => x / 2); }
function positions(list) { return list.map((x, i) => x + i); }
function great(list) { return list.filter(x => x > 2); }
function other(list) { return list.filter(x => x !== 3); }
function total(list) { return list.reduce((a, b) => a + b, 0); }
function most(list) { return list.length ? list.reduce((a, b) => Math.max(a, b)) : "none"; }
function least(list) { return list.reduce((a, b) => b < a ? b : a, 100); }
function some(list) { return list.some(x => x === 3); }
function found(list) { return list.find(x => x > 3); }
function even(list) { return list.filter(x => x % 2 === 0).length; }
function both(list) { return list.filter(x => x > 1).map(x => x * 10); }
function joined(list) { return list.map(x => ({ x })).map(o => o.x + ":" + o.x); }
const json = v => JSON.parse(JSON.stringify(v));
function lists() {
    const getter = [1, 2, 3, 4];
    Object.defineProperty(getter, 2, { get() { seen.push("get"); return 5; }, enumerable: true });
    return [[], json([1]), json([1, 2, 3, 4]), json([0.5, 1.5, -2.5, 4]), json([1, 2.5, 3]), json(Array.from({ length: 40 }, (_, i) => i * 37 % 41)), json(["a", "b"]), json([1, "2", null, true]), [-0, 0, NaN], [2147483647, 1], [4294967296, 1], [1n, 2n], [1, 2n], [Symbol.iterator], [undefined, 1], [null, 2], [1, , 3],
        [{ valueOf() { seen.push("valueOf"); return 4; }, toString() { seen.push("toString"); return "s"; } }, 2], [2, { valueOf() { throw new SyntaxError("t"); } }, 3], [[1], [2, 3]], [{}], getter, new Proxy([1, 2, 3], { get(target, key) { seen.push(String(key)); return target[key]; } }), new Float64Array([1, 2.5, 3]), [true, false]];
}
function once(list) {
    let said = "";
    for (let f = 0; f < 14; f++) {
        let result;
        try {
            switch (f) {
            case 0: result = doubled(list); break;
            case 1: result = next(list); break;
            case 2: result = halves(list); break;
            case 3: result = positions(list); break;
            case 4: result = great(list); break;
            case 5: result = other(list); break;
            case 6: result = total(list); break;
            case 7: result = most(list); break;
            case 8: result = least(list); break;
            case 9: result = some(list); break;
            case 10: result = found(list); break;
            case 11: result = even(list); break;
            case 12: result = both(list); break;
            case 13: result = joined(list); break;
            }
            said += say(result) + " ";
        } catch (e) { said += e.constructor.name + " "; }
        said += seen.join() + " ";
        seen.length = 0;
    }
    return said;
}
for (let turn = 0; turn < 3; turn++) for (const [k, list] of lists().entries()) console.log(k, once(list));
