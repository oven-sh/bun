// answers: without-library
// # what was seen to arrive at a handler is expected of what it catches, and no more than expected: an object of another class, a literal, a getter, a primitive, undefined, an error of the engine's own all come to the reads as they are written
// # the hostile objects come out of a list that JSON.parse has made, so nobody sees them arrive. Thrown in plain sight they are seen at the handler beside Stop: then any object is expected there, which is nothing, and no row is written
// # f1 = walk, f2 = find, f3 = inLoop, f4 = engine, f6 = tell, f5 = hide
// # RUN(FORM): link held functions mechanisms=all
// # FORM: catch f2 b{{*}} caught={{*}}L0
// # RUN(WITHHELD): link held functions mechanisms=all-Handlers
// # WITHHELD-NOT: catch f2
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let reads = 0;
class Stop { node: unknown; depth: number; constructor(node: unknown, depth: number) { this.node = node; this.depth = depth; } }
class Other { node: unknown; depth: number; constructor(node: unknown, depth: number) { this.node = node; this.depth = depth; } }
const kept = new Other("kept", 9);
const box = JSON.parse("[0]");
function walk(thrown: unknown, hostile: boolean): never { if (hostile) throw thrown; throw new Stop("stop", 1); }
function find(thrown: unknown, hostile: boolean) { try { walk(thrown, hostile); } catch (e: any) { return String(e.node) + String(e.depth); } }
function inLoop(list: unknown[]) { let text = ""; for (let i = 0; i < list.length; i++) { try { walk(list[i], i > 0); } catch (e: any) { text += String(e.node) + String(e.depth) + ";"; } } return text; }
function engine(o: any) { try { if (o.stop) walk(null, false); return o.value.deep; } catch (e: any) { return String(e.node) + String(e.name); } }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function hide(x: unknown): any { box[0] = x; return box[0]; }
tell(() => find(null, false));
tell(() => find(hide(kept), true));
tell(() => find(hide({ depth: 2, node: "literal" }), true));
tell(() => find(hide({ get node() { reads++; return "getter"; }, depth: 3 }), true));
tell(() => find("text", true));
tell(() => find(7, true));
tell(() => find(undefined, true));
tell(() => find(null, true));
tell(() => find(Object.freeze(new Stop("frozen", 4)), true));
tell(() => find(hide(Object.create(Stop.prototype)), true));
tell(() => find(hide(new Error("error")), true));
tell(() => find(null, false));
tell(() => inLoop([0, hide(kept), "text", new Stop("again", 5), hide({ node: 1 })]));
tell(() => inLoop([0, undefined]));
tell(() => engine({ stop: true }));
tell(() => engine({ stop: false }));
tell(() => engine({ stop: false, value: { deep: "deep" } }));
tell(() => engine(null));
report(reads);
report("end");
