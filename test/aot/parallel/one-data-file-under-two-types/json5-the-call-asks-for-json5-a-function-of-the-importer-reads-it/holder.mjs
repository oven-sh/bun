import conf from "./conf.json5" with { type: "text" };
export function seen() { let last; for (let i = 0; i < 300; i++) last = typeof conf === "string" ? conf.length : conf.port; return last; }
