function User(name) { this.name = name; }
User.prototype = { get name() { return this._name; }, set name(v) { this._name = v.trim(); } };
const u = new User(" a "); console.log(u.name, Object.keys(u).join());
