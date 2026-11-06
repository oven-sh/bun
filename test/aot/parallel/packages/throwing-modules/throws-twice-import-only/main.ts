// @ts-nocheck
const say = (what, v) => console.log(what, v);
const byRequire = () => { try { return JSON.stringify(require("./throws-twice.cjs")); } catch (e) { return "threw " + e.message; } };
const byImport = async () => { try { return JSON.stringify(await import("./throws-twice.cjs")); } catch (e) { return "threw " + e.message; } };
for (let i = 0; i < 4; i++) say("import()", await byImport());
say("evaluations", globalThis.evaluations);
