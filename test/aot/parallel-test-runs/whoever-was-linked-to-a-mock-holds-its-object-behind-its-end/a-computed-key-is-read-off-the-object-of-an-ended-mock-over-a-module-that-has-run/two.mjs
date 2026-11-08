import * as dep from "./dep.mjs";
const say = read => { try { return String(read()); } catch (e) { return e.name; } };
export const byKey = key => { const said = []; for (let i = 0; i < 8; i++) said.push(say(() => dep[key])); return said.join(","); };
export const byName = () => say(() => dep.kind);
export const has = key => say(() => key in dep);
