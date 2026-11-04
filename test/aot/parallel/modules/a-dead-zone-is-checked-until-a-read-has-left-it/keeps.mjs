export function kept() { const out = []; for (let i = 0; i < 2; i++) { try { out.push(globalThis.escaped()); } catch (e) { out.push(e.name); } } return out; }
