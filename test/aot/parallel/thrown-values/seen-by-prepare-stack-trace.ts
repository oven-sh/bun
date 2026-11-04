// an error of the engine's own class is thrown and caught, and the read of its stack hands it to Error.prepareStackTrace, which lays a name on it. Whoever made the error then reads the name
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
(Error as any).prepareStackTrace = (e: any) => { e.extra = "text"; return "stack"; };
function read(made: any) { return String(made.extra); }
function deed(made: Error) { try { throw made; } catch (e) { return String((e as Error).stack); } }
const held = new Error("failed");
console.log(read(held));
console.log(deed(held));
console.log(read(held));
for (let i = 0; i < 3; i++) { const next = new Error("failed" + i); console.log(read(next)); console.log(deed(next)); console.log(read(next)); }
