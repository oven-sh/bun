export let k = () => "first";
export const inside = () => { try { return typeof k === "function" ? (k.who ? k.who() : k()) : typeof k === "object" ? "object " + k.a : "value " + (k + 1); } catch (e) { return "threw " + e.name; } };
export function hot() { let r; for (let i = 0; i < 50; i++) r = inside(); return r; }
