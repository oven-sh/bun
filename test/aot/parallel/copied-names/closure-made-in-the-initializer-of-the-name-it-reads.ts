function outer(): string { function make(n: number): string { const handler = { get(key: string): unknown { return key === "self" ? handler.tag : size(); }, tag: "t" + n }; return String(handler.get("self")) + handler.get("size"); function size(): number { return n; } } return make(1) + make(2); }
console.log(outer());
