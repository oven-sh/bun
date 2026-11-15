import dep from "./dep.json";
const say = read => { try { return String(read()); } catch (e) { return e.name; } };
export const seen = () => say(() => dep.kind) + " " + say(() => Object.keys(dep).sort().join("+"));
