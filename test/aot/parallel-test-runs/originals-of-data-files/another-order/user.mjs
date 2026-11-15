import "./before.mjs";
import * as a from "./a.json";
import "./after.mjs";
const note = text => (globalThis.order ??= []).push(text);
note("user");
export const say = () => globalThis.order.join(" ") + " | " + (a.kept ?? a.default);
