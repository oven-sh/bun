// an index on the prototypes
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 }); list.length = 4;
try { (Array.prototype as any)[2] = "of Array.prototype"; out.push("stored"); } catch (e) { out.push("refused"); }
try { (Object.prototype as any)[3] = "of Object.prototype"; out.push("stored"); } catch (e) { out.push("refused"); }
const stored = out.splice(0, 2).join();
{ const got: string[] = []; for (let i = 0; i < hidden<number>("5"); i++) got.push(say(list[i])); out.push(got.join()); }
// An executable refuses both, and then a hole reads as undefined.
out[0] = stored === "refused,refused" ? String(out[0] === 'object:{"v":1},undefined:undefined,undefined:undefined,undefined:undefined,undefined:undefined') : String(out[0] === 'object:{"v":1},undefined:undefined,string:of Array.prototype,string:of Object.prototype,undefined:undefined');
console.log(out.join(" | "));
