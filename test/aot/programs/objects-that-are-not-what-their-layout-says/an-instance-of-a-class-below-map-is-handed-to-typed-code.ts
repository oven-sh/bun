class Registry extends Map<string, number> { extra = 5; total(): number { let sum = this.extra; for (const value of this.values()) sum += value; return sum; } }
const registry = new Registry([["a", 1], ["b", 2]]);
function look(r: Registry): number { return r.total() + r.size + r.extra; }
console.log(look(registry), registry instanceof Map, registry.get("b"));
