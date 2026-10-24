// `let found = null` without a written type, under "strict" with "noImplicitAny": false: TypeScript gives the variable the type null, and takes a store of `any`. Nobody wrote that type: the variable holds what is stored.
const frames: any[] = [{ file: "" }, { file: "a.ts" }, { file: "b.ts" }];
function first() { let found = null; for (const frame of frames) { const file = frame.file; if (file && file !== "") { found = file; break; } } return found; }
function none() { let found = null; for (const frame of [] as any[]) found = frame; return found; }
function undefinedFirst() { let found = undefined; for (const frame of frames) found = frame.file; return found; }
function inAClosure() { let found = null; frames.forEach(frame => { found = frame.file; }); return found; }
function anObject() { let found = null; for (const frame of frames) found = frame; return JSON.stringify(found); }
function byVar() { var found = null; found = frames[1].file; return found; }
let ofTheModule = null;
function storesToIt() { ofTheModule = frames[2].file; }
storesToIt();
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + String(r)); };
row("a string is stored", first);
row("nothing is stored", none);
row("undefined first", undefinedFirst);
row("stored in a closure", inAClosure);
row("an object is stored", anObject);
row("var", byVar);
row("a variable of the module", () => ofTheModule);
row("used afterwards", () => { const found = first(); return typeof found + " " + (found as any).length; });
