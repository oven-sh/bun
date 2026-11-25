import { wordR, sayR } from "./way1.mjs";
import * as all from "./way1.mjs";
const tell = f => { try { return f(); } catch (error) { return error.name; } };
export const read = () => [tell(() => wordR), tell(() => sayR()), tell(() => all.wordR), tell(() => all.sayR()), Object.keys(all).sort().join("/")].join();
export const held = { get word() { return tell(() => wordR); } };
export { all };
