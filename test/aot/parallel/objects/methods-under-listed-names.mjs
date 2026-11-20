// Methods that a loop over a constant list of names lays on a prototype: the list is read in other functions of the file.
const METHODS = ["get", "post", "put"];
class App {
  constructor() { this.count = 0; }
  has(name) { return METHODS.includes(name) && METHODS.indexOf(name) >= 0; }
}
METHODS.forEach(method => {
  App.prototype[method] = function (path) { return this.has(method) ? path.length + this.count++ : -1; };
});
const app = new App();
console.log(app.get("a"), app.post("ab"), app.put("abc"), app.has("delete"));
const LEVELS = ["debug", "info", "warn"];
function Logger(prefix) { this.prefix = prefix; }
LEVELS.forEach(level => { Logger.prototype[level] = function (text) { return `${this.prefix} ${level} ${text} ${LEVELS.indexOf(level)}`; }; });
for (const level of LEVELS) console.log(new Logger("a")[level](LEVELS.length));
class Store { constructor() { this.keys = ["a", "b"].concat(METHODS).join(); } static names() { return [...METHODS, ...LEVELS].sort().join(); } }
["open", "close"].forEach(name => { Store.prototype[name] = function () { return name + this.keys; }; });
console.log(new Store().open(), new Store().close(), Store.names(), Object.keys(App.prototype).join(), Object.keys(Logger.prototype).join());
