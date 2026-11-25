import * as kit from "./index.mjs";
globalThis.look = () => typeof kit.promises.readFile;
export { kit };
