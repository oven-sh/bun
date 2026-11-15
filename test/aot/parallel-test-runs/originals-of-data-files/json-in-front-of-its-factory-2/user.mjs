import "./before.mjs";
import * as unit from "./unit.json";
import "./after.mjs";
const note = text => (globalThis.order ??= []).push(text);
note("user");
export const say = () => globalThis.order.join(" ") + " | " + (unit.kept ?? unit.default);
