exports.hasIn = function (one, key) { return one.has(key); };
exports.getFrom = function (one, key) { return one.get(key); };
exports.setIn = function (one, key, value) { return one.set(key, value); };
exports.deleteFrom = function (one, key) { return one.delete(key); };
exports.Keeper = class Keeper {
    constructor() { this.kept = new Map(); this.calls = 0; }
    has(key) { this.calls++; return this.kept.has(key) ? "kept" : "lacking"; }
    get(key) { this.calls++; return this.kept.get(key) ?? "nothing"; }
    set(key, value) { this.kept.set(key, value); return this.calls; }
    delete(key) { return this.kept.delete(key) ? "gone" : "never there"; }
};
