// the Boolean that was tested is read behind an await and behind a yield
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
async function waits(a, b) { const same = a === b; if (same) { await 0; return [same, "yes"]; } await 0; return [same, "no"]; }
function* yields(a, b) { const same = a === b; if (same) { yield "yes"; yield same; } else { yield "no"; yield same; } }
const out = [];
for (const v of values) out.push(JSON.stringify(await waits(v, 1)) + JSON.stringify([...yields(v, 1)]));
console.log(out.join(" "));
