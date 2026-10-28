export function kindOf(o) { return o.kind; }
export function kindsOf(all) { let text = ""; for (const o of all) text += o.kind + ","; return text; }
export function lengthsOf(all) { let sum = 0; for (const o of all) { const kind = o.kind; if (typeof kind === "string") sum += kind.length; const mode = o.mode; if (mode === "on") sum += 100; else if (mode !== undefined) sum += mode.length; } return sum; }
export function countOf(all, kind) { let n = 0; for (const o of all) if (o.kind === kind) n++; return n; }
export function callKind(o) { try { return o.kind(); } catch (error) { return error.constructor.name; } }
