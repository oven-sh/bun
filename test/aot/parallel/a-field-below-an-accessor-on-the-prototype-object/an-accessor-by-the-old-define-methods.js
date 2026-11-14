function User(name) { this.name = name; }
User.prototype.__defineGetter__("name", function () { return this._name; }); User.prototype.__defineSetter__("name", function (v) { this._name = v.trim(); });
const u = new User(" a "); console.log(u.name, Object.keys(u).join());
