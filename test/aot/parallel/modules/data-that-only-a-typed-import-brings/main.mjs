// A data file that only an import with `{ type: "json" }` brings into the executable, asked for under names made at run time, without the attribute and with it.
// `bun run` keeps what the attribute asks for apart from what an import without one gets; its require() looks in both places before it reads the file.
import typed from "./typed-alone.json" with { type: "json" };
import both from "./both.json" with { type: "json" };
import untyped from "./both.json";
const say = async f => { try { return JSON.stringify(await f()); } catch (e) { return e.constructor.name + ": " + (e.code ?? "") + " " + e.message; } };
const name = text => globalThis.never ?? text;
console.log(typed.n, both.n, untyped.n, both === untyped);
console.log("require", await say(() => require(name("./typed-alone.json"))), require(name("./typed-alone.json")).default === typed);
console.log("held", await say(() => [require][0]("./typed-alone.json")));
console.log("import", await say(async () => (await import(name("./typed-alone.json"))).default));
console.log("import with the type", (await import(name("./typed-alone.json"), { with: { type: "json" } })).default === typed);
console.log("both", require(name("./both.json")).default === untyped, (await import(name("./both.json"))).default === untyped, (await import(name("./both.json"), { with: { type: "json" } })).default === both);
