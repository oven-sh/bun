import * as dep from "./dep.json";
const say = read => { try { return String(read()); } catch (e) { return e.name; } };
export const seen = () => [say(() => dep.kind), say(() => dep[JSON.parse('"kind"')]), say(() => Object.keys(dep).sort().join("+")), say(() => "only" in dep), say(() => dep.default.kind)].join(" ");
