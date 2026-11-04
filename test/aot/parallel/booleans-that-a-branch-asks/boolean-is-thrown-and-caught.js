// the Boolean that was tested is thrown on one side, and read in the handler and in the finally
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(a, b) { const same = a === b; const seen = []; try { if (same) throw same; seen.push(same); } catch (e) { seen.push(e, same); } finally { seen.push(same); } return seen; }
console.log(values.map(v => JSON.stringify(subject(v, 1))).join(" "));
