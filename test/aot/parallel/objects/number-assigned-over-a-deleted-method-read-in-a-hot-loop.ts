// A field made for a method is deleted, and Object.assign then gives the object a number under the name. A typed read in a hot loop must find the number.
function read(held: { f?: unknown }) { return held.f; }
function make() { return { ...{ f() { return 1; } } }; }
function change(loose: any) { Reflect.deleteProperty(loose, "f"); Object.assign(loose, JSON.parse('{"f":2}')); }
function run() { const o = make(); change(o); return read(o); }
for (let i = 0; i < 300; i++) if (run() !== 2) { console.log("wrong at", i, run()); break; }

function readOther(held: { g?: unknown }) { return held.g; }
function makeOther() { return { ...{ g() { return 1; } } }; }
function changeOther(loose: any) { delete loose.g; for (const key of ["g"]) loose[key] = true; }
function runOther() { const o = makeOther(); changeOther(o); return readOther(o); }
for (let i = 0; i < 300; i++) if (runOther() !== true) { console.log("wrong at", i, runOther()); break; }

function readGone(held: { h?: unknown }) { return held.h; }
function makeGone() { return { ...{ h() { return 1; } } }; }
function runGone() { const o = makeGone(); Reflect.deleteProperty(o, "h"); return readGone(o); }
for (let i = 0; i < 300; i++) if (runGone() !== undefined) { console.log("wrong at", i, runGone()); break; }
console.log("done");
