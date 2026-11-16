import settings from "./settings.json";
import { run } from "./runner.cjs";
const text = Buffer.from(`import(${JSON.stringify(import.meta.dir + "/settings.json")}).then(m => { m.default.mode = "second"; })`).toString();
try { await run(text); } catch (error) { console.log("threw", error?.code ?? error?.name); }
console.log(settings.mode);
