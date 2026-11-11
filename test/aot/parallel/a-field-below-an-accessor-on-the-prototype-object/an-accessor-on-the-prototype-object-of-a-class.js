class K { constructor(n) { this.n = n; } }
const first = new K(1); Object.defineProperty(K.prototype, "n", { get() { return this._n; }, set(v) { this._n = v; }, configurable: true }); const k = new K(2); console.log(first.n, k.n, Object.keys(k).join());
