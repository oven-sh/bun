import dep from "dep";
const show = dep => { try { return dep.value() + ":" + String(dep.kind) + ":" + String(dep.added); } catch (e) { return e.name; } };
export const seen = async () => show(dep);
