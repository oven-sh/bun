// A destructured name under `with` is resolved when its value is stored: after the read and the default, in an assignment and in a `var` alike.
function iterableThatRuns(effect) {
  return {
    [Symbol.iterator]() {
      return {
        next() {
          effect();
          return { value: "stored", done: false };
        },
        return() {
          return {};
        },
      };
    },
  };
}

function assignmentWhoseStepDeletes() {
  var a = "variable";
  var scope = { a: "property" };
  var iterable = iterableThatRuns(() => delete scope.a);
  with (scope) {
    [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array assignment, the step deletes the property:", assignmentWhoseStepDeletes());

function declarationWhoseStepDeletes() {
  var scope = { a: "property" };
  var iterable = iterableThatRuns(() => delete scope.a);
  with (scope) {
    var [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array declaration, the step deletes the property:", declarationWhoseStepDeletes());

function assignmentWhoseStepAdds() {
  var a = "variable";
  var scope = {};
  var iterable = iterableThatRuns(() => (scope.a = "property"));
  with (scope) {
    [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array assignment, the step adds the property:", assignmentWhoseStepAdds());

function declarationWhoseStepAdds() {
  var scope = {};
  var iterable = iterableThatRuns(() => (scope.a = "property"));
  with (scope) {
    var [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array declaration, the step adds the property:", declarationWhoseStepAdds());

function assignmentWhoseGetterDeletes() {
  var a = "variable";
  var scope = { a: "property" };
  var source = {
    get a() {
      delete scope.a;
      return "stored";
    },
  };
  with (scope) {
    ({ a } = source);
  }
  return scope.a + " " + a;
}
console.log("object assignment, the getter deletes the property:", assignmentWhoseGetterDeletes());

function declarationWhoseGetterDeletes() {
  var scope = { a: "property" };
  var source = {
    get a() {
      delete scope.a;
      return "stored";
    },
  };
  with (scope) {
    var { a } = source;
  }
  return scope.a + " " + a;
}
console.log("object declaration, the getter deletes the property:", declarationWhoseGetterDeletes());

function defaultAddsProperty() {
  var a = "variable";
  var holder = {};
  var scope = holder;
  with (scope) {
    [a = ((holder.a = "property"), "stored")] = [];
  }
  return holder.a + " " + a;
}
console.log("the default adds the property:", defaultAddsProperty());

function lookupFollowsRead() {
  var a;
  var order = [];
  var scope = new Proxy(
    {},
    {
      has(target, key) {
        if (key === "a") order.push("has a");
        return Reflect.has(target, key);
      },
    },
  );
  var source = {
    get a() {
      order.push("get a");
      return 1;
    },
  };
  with (scope) {
    ({ a } = source);
  }
  return order.join() + " " + a;
}
console.log("the lookup follows the read:", lookupFollowsRead());

function memberTargetComesFirst() {
  var order = [];
  var target = {};
  var scope = {
    get holder() {
      order.push("holder");
      return target;
    },
  };
  var iterable = iterableThatRuns(() => order.push("next"));
  with (scope) {
    [holder.a] = iterable;
  }
  return order.join() + " " + target.a;
}
console.log("the object of a member target comes before the step:", memberTargetComesFirst());

function loopHeadsStoreThroughScope() {
  var scope = { a: "property", b: "property" };
  with (scope) {
    for (var a of ["stored"]);
    for (var [b] of [["stored"]]);
  }
  return scope.a + " " + a + " " + scope.b + " " + b;
}
console.log("`var` in a loop head:", loopHeadsStoreThroughScope());
