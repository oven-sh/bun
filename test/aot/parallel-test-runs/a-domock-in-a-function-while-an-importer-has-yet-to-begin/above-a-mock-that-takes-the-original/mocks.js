import { mockModule } from "./wrap.js";
import "./importer.js";
mockModule(import.meta.dir + "/dep.js", () => ({ who: () => "mock" }));
console.log("SAID the call has returned");
