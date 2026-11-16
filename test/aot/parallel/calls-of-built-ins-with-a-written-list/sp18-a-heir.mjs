class M extends Map { get(k) { return super.get(...[k]) ?? "none";
} } const m = new M([["a", 1]]);
console.log(m.get("a"), m.get(...["z"]), Map.prototype.get.call(m, ...["a"]));
export {};
