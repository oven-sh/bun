import { who } from "./dep.js";
console.log("SAID the helper runs");
globalThis.mockDepOfPreload(() => ({ who: () => "mock" }));
export const read = () => who();
