import { mockModule } from "./wrap.js";
import { who } from "./dep.js";
mockModule(import.meta.dir + "/dep.js", () => ({ who: () => "mock" }));
console.log("SAID the call has returned");
export const read = () => who();
