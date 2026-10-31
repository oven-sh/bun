var attempt = require("./show").attempt;
var user = require("./user");
var lib = require("./lib");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function all(when) {
  Object.keys(user).forEach(function (name) {
    attempt(when + " " + name, function () {
      return user[name]([1, 2, 3]);
    });
  });
}

all("at first");
var sum = 0;
for (var i = 0; i < 2000; i++) sum += user.throughTheObject([i]) + user.throughTheCopy([i]) + user.nextVersion() + user.count() + user.joined().length;
console.log("sum", sum);
lib.change();
all("changed");
lib.changeBack();
all("changed back");
for (var round = 0; round < 6; round++) {
  if (round % 2) lib.change();
  else lib.changeBack();
  attempt("round " + round, function () {
    return [user.throughTheObject([1]), user.nextVersion(), user.joined(), user.count()];
  });
}
