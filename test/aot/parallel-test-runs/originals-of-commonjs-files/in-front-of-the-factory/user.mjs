import "./before.mjs";
import { unit } from "./between.mjs";
import "./after.mjs";
const note = text => (globalThis.order ??= []).push(text);
note("user");
export const say = () => globalThis.order.join(" ") + " | " + (unit.kept ?? unit.default);
