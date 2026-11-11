function App() {
  this.routes = [];
}
["get", "post", "remove"].forEach(function (verb) {
  App.prototype[verb] = function (path) {
    this.routes.push(verb + " " + path);
    return this;
  };
});
var extras = { describe: function () { return this.routes.join(", "); }, count: function () { return this.routes.length; } };
for (var name in extras) App.prototype[name] = extras[name];
Object.defineProperty(App.prototype, "first", { get: function () { return this.routes[0]; } });
module.exports = App;
