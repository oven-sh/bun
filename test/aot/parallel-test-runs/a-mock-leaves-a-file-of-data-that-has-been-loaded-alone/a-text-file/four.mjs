import * as dep from "./dep.txt";
const say = read => { try { return String(read()); } catch (e) { return e.name; } };
export const seen = () => [say(() => dep.kind), say(() => Object.keys(dep).sort().join("+")), say(() => JSON.stringify(dep.default))].join(" ");
export const held = () => dep;
