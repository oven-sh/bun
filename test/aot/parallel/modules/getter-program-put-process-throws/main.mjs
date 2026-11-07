// A getter that the program put on process throws where a statement imports node process.
const holder = process;
const log = [];
globalThis.note = text => log.push(text);
const show = what => { console.log(what + ":", log.join(" ") || "nothing"); log.length = 0; };
const attempt = async (what, run) => { try { console.log(what, await run()); } catch (error) { console.log(what, "throws", error.name, String(error.message).slice(0, 70)); } show(what); };

Object.defineProperty(holder, "custom", { get() { note("get"); throw new Error("no"); }, enumerable: true, configurable: true });
let file;
try { file = await import("./reads.mjs"); show("import"); } catch (error) { console.log("import throws", error.name, String(error.message).slice(0, 90)); show("import"); }
if (file) {
await attempt("read", () => file.read());
}
