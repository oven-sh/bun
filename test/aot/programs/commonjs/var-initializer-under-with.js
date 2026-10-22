// `var x = e` under `with` resolves `x` before it evaluates `e`, so an initializer that adds or deletes the property does not change where the value goes.
function initializerDeletesProperty() {
  var scope = { x: 0 };
  with (scope) {
    var x = (delete scope.x, 1);
  }
  return scope.x + " " + x;
}
console.log("initializer deletes the property:", initializerDeletesProperty());

function initializerAddsProperty() {
  var scope = {};
  with (scope) {
    var x = ((scope.x = 5), 1);
  }
  return scope.x + " " + x;
}
console.log("initializer adds the property:", initializerAddsProperty());

function initializerMovesProperty() {
  var outer = {};
  var inner = { x: "inner" };
  with (outer) {
    with (inner) {
      var x = (delete inner.x, (outer.x = "outer"), "stored");
    }
  }
  return outer.x + " " + inner.x + " " + x;
}
console.log("initializer moves the property to the outer object:", initializerMovesProperty());

function lookupComesFirst() {
  var order = [];
  var scope = new Proxy(
    {},
    {
      has(target, key) {
        if (key === "x") order.push("has x");
        return Reflect.has(target, key);
      },
    },
  );
  with (scope) {
    var x = order.push("initializer");
  }
  return order.join() + " " + x;
}
console.log("the lookup comes first:", lookupComesFirst());

function functionIsNamed() {
  var scope = { named: null };
  with (scope) {
    var named = function () {};
  }
  return scope.named.name + " " + named;
}
console.log("a function is named by the variable:", functionIsNamed());
