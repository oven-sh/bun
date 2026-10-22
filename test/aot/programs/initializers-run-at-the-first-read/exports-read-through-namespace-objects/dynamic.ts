export const CONFIG = { name: "dynamic", parts: ["a", "b"] };
export const DERIVED = CONFIG.parts.map(p => p.toUpperCase());
export const MAYBE: { v: number } | undefined = { v: 1 };
export default { kind: "default export" };
