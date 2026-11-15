import { who } from "./dep.js";
globalThis.mockDepOfPreload(() => ({ who: () => "mock" }));
export const read = () => who();
