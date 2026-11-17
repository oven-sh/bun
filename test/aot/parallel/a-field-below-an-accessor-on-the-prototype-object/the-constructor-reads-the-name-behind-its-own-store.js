function User(name) { this.name = name; this.size = this.name.length; }
Object.defineProperty(User.prototype, "name", { get() { return [1, 2, 3]; }, set(v) { }, configurable: true });
console.log(new User("ab").size, Object.keys(new User("ab")).join());
