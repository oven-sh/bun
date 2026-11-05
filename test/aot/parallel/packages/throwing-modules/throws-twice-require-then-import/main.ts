// @ts-nocheck
const say = (what, v) => console.log(what, v);
const byRequire = () => { try { return JSON.stringify(require("./throws-twice.cjs")); } catch (e) { return "threw " + e.message; } };
const byImport = async () => { try { return JSON.stringify(await import("./throws-twice.cjs")); } catch (e) { return "threw " + e.message; } };
say("require", byRequire()); say("import()", await byImport()); say("require", byRequire()); say("import()", await byImport()); say("import()", await byImport());
say("evaluations", globalThis.evaluations);
/* Output:
require threw evaluation 1
import() threw evaluation 1
require threw evaluation 1
import() threw evaluation 1
import() threw evaluation 1
evaluations 1
*/
