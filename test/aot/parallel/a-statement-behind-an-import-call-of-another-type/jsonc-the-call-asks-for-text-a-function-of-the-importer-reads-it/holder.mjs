import conf from "./conf.jsonc" with { type: "jsonc" };
export function seen() { let last; for (let i = 0; i < 300; i++) last = typeof conf === "string" ? conf.length : conf.port; return last; }
