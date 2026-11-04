export function peek() { try { return typeof arrow; } catch (e) { return e.name; } }
globalThis.kept = { peek, take: () => arrow };
if (process.argv.length < 100) throw new Error("the body stops");
export const arrow = x => x + 1;
