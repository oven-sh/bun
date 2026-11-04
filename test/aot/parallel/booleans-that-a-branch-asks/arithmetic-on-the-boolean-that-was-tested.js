// the Boolean that was tested is added, joined to a text and compared on each side
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(a, b) { const same = a === b; if (same) return [same + 1, same + "", same == 1, same === true, +same, -same, same | 0, `${same}`]; return [same + 1, same + "", same == 0, same === false, +same, -same, same | 0, `${same}`]; }
console.log(values.map(v => subject(v, 1).map(show).join(",")).join(" "));
