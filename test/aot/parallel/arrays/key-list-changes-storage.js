// Object.keys of a known layout is written out as a new array. Each line then changes the array in a way that can change its storage, and reads it again.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function tell(name, run) { try { console.log(name, JSON.stringify(run())); } catch (error) { console.log(name, error.constructor.name); } }
const keys = () => Object.keys({ k: 1, l: 2 });
tell("far store", () => { const a = Object.keys({ k: 1, l: 2 }); a[5000] = "far"; return [a[0], a[1], a[2], a[5000], a.length, a.indexOf("far"), a.at(-1)]; });
tell("very far store", () => { const a = Object.keys({ k: 1, l: 2 }); a[4000000000] = "far"; return [a[0], a[1], a[4000000000], a.length, a.lastIndexOf("far")]; });
tell("length up", () => { const a = Object.keys({ k: 1, l: 2 }); a.length = 200000; return [a[0], a[1], a[2], a.length, a.includes(undefined)]; });
tell("length huge", () => { const a = Object.keys({ k: 1, l: 2 }); a.length = 4294967295; return [a[0], a[1], a[2], a.length]; });
tell("length down", () => { const a = Object.keys({ k: 1, l: 2 }); a.length = 1; return [a[0], a[1], a.length]; });
tell("define index", () => { const a = Object.keys({ k: 1, l: 2 }); Object.defineProperty(a, 0, { get() { return "got"; } }); return [a[0], a[1], a.join()]; });
tell("define read-only", () => { const a = Object.keys({ k: 1, l: 2 }); Object.defineProperty(a, 1, { value: "fixed", writable: false }); try { a[1] = "x"; } catch {} return [a[0], a[1]]; });
tell("freeze", () => { const a = Object.keys({ k: 1, l: 2 }); Object.freeze(a); try { a[0] = "x"; } catch {} return [a[0], a[1], a.length]; });
tell("seal", () => { const a = Object.keys({ k: 1, l: 2 }); Object.seal(a); a[0] = "x"; try { a[2] = "y"; } catch {} return [a[0], a[1], a[2], a.length]; });
tell("prevent", () => { const a = Object.keys({ k: 1, l: 2 }); Object.preventExtensions(a); try { a.push("y"); } catch {} return [a[0], a[1], a.length]; });
tell("hole", () => { const a = Object.keys({ k: 1, l: 2 }); delete a[0]; return [a[0], a[1], a.length, 0 in a]; });
tell("name", () => { const a = Object.keys({ k: 1, l: 2 }); a.name = "n"; a["-1"] = "m"; a["1.5"] = "f"; return [a[0], a[1], a.name, a["-1"], a["1.5"], a.length]; });
tell("number", () => { const a = Object.keys({ k: 1, l: 2 }); a[0] = 1; a[1] = 1.5; return [a[0], a[1], a[0] + a[1]]; });
tell("unshift", () => { const a = Object.keys({ k: 1, l: 2 }); a.unshift("u"); return [a[0], a[1], a[2], a.length]; });
tell("splice", () => { const a = Object.keys({ k: 1, l: 2 }); a.splice(0, 1); return [a[0], a[1], a.length]; });
tell("prototype", () => { const a = Object.keys({ k: 1, l: 2 }); const heir = Object.create(a); return [a[0], heir[1], heir.length]; });
tell("set prototype", () => { const a = Object.keys({ k: 1, l: 2 }); Object.setPrototypeOf(a, { 5: "up" }); return [a[0], a[5], a.length]; });
tell("push many", () => { const a = Object.keys({ k: 1, l: 2 }); for (let i = 0; i < 300000; i++) a.push("p"); return [a[0], a[299999], a.length]; });
tell("shift many", () => { const a = Object.keys({ k: 1, l: 2 }); for (let i = 0; i < 300000; i++) a.push("p"); a.shift(); a.unshift("u", "v"); return [a[0], a[1], a[2], a.length]; });
tell("outside", () => { const a = keys(); a[5000] = "far"; return [a[0], a[5000], a.length]; });

function storesFar() { const a = Object.keys({ k: 1 }); a[5000] = "far"; return a.at(0) + a.length + a.includes("far") + a.indexOf("far"); }
function storesFarInLoop() {
  const a = Object.keys({ k: 1 });
  let said = "";
  for (let i = 0; i < 2; i++) {
    if (i) a[5000] = "far";
    said += a.includes(2) + " " + a[0] + " " + a[5000] + " " + a.length + ";";
  }
  return said;
}
function grows(n) { const a = Object.keys({ k: 1, l: 2 }); a.length = n; return a[n - 1] + " " + a[0] + " " + a.length; }
for (let i = 0; i < 3; i++) console.log(storesFar(), storesFarInLoop(), grows(3), grows(100), grows(200000));

// The loop that the expansion is for: the list is only read.
function sum(point) { let total = 0; for (const key of Object.keys(point)) total += point[key]; return total; }
let total = 0;
for (let i = 0; i < 1000; i++) total += sum({ x: i, y: 2, z: 3 });
console.log(total);
