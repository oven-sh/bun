function User(name) { this.name = name; }
Object.defineProperties(User.prototype, { name: { get() { return this._name; }, set(v) { this._name = v.trim(); }, configurable: true } });
const u = new User(" a "); console.log(u.name, Object.keys(u).join());
