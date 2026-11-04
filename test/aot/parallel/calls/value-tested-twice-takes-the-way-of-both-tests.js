// A value that has passed one typeof test is tested again, by a wider test, a narrower one and one that has nothing in common with the first, and what is stored behind each pair is read back.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a field that is stored behind two tests
const seen = { wider: "none", narrower: "none", neither: "none" };
function wider(a) { if (typeof a === "string") { if (typeof a === "string" || typeof a === "number") seen.wider = a; } }
function narrower(a) { if (typeof a === "string" || typeof a === "number") { if (typeof a === "string") seen.narrower = a; } }
function neither(a) { if (typeof a === "string") { if (typeof a === "number") seen.neither = a; } }
function all(a) { wider(a); narrower(a); neither(a); return seen.wider + "/" + seen.narrower + "/" + seen.neither; }
function looped() { let s = ""; const values = ["x", 2, null, "y"]; for (let i = 0; i < 4; i++) s += all(values[i]) + ","; return s; }
console.log(all("a"), all(1), all({}), looped());
