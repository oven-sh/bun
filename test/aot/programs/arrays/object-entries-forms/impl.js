export function entriesUntyped(o) { return Object.entries(o) }
export function loopUntyped(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(k + "=" + String(v)); return out }
