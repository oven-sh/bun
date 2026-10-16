// What `Array.isArray` has narrowed is kept in a const without an annotation and pushed to.
declare const console: { log(...values: unknown[]): void };
function words(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).message.split(" (bun")[0].split("\n")[0] } }
function keeps(x: unknown): string { if (!Array.isArray(x)) return "no"; const kept = x; kept.push(9); return kept.join() }
console.log("6 " + words(() => keeps(new Proxy([1], {})) + " " + keeps([2])));
