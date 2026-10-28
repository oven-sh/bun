// The variable that holds the helper is assigned again between two calls, and the helper is also reached under other names.
function define(target, name) {
  target[name] = function () {
    return "first " + name;
  };
}
var target = {};
define(target, "a");
var kept = define;
define = function (target, name) {
  target[name] = function () {
    return "second " + name;
  };
};
define(target, "b");
kept(target, "c");
var holder = { define: kept };
holder.define(target, "d");
for (var name of ["e", "f"]) kept(target, name);
console.log(target.a(), target.b(), target.c(), target.d(), target.e(), target.f());
