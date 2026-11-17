interface User { name: string; _name: string; }
function User(this: User, name: string) { this.name = name; }
Object.defineProperty(User.prototype, "name", { get(this: User) { return this._name; }, set(this: User, v: string) { this._name = v.trim(); }, configurable: true });
const u = new (User as unknown as new (name: string) => User)(" a "); console.log(u.name, Object.keys(u).join());
