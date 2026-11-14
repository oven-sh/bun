import { word, say } from "./way2.mjs";
import * as all from "./way2.mjs";
const tell = f => { try { return f(); } catch (error) { return error.name; } };
export const read = () => [tell(() => word), tell(() => say()), tell(() => all.word), tell(() => all.say()), Object.keys(all).sort().join("/")].join();
export const held = { get word() { return tell(() => word); } };
export { all };
