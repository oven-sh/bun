export const log = [];
export function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
