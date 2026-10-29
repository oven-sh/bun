// Prints the frames between a constructor that throws and the function that called Reflect.construct.
Error.prepareStackTrace = (error, sites) =>
  sites.map(
    site =>
      (site.isConstructor() ? "new " : "") + (site.getFunctionName() ?? "-") + (site.isNative() ? " [native]" : ""),
  );
function fail() {
  throw new Error("fail");
}
function Thrower() {
  throw new Error("Thrower");
}
function pass(value) {
  return value;
}
function check(run) {
  try {
    run();
    console.log(run.name, "no error");
  } catch (error) {
    const frames = Array.isArray(error.stack) ? error.stack : [String(error.stack)];
    console.log(run.name, error.constructor.name, frames.slice(0, frames.indexOf("check")).join(" < "));
  }
}
check(function emptyList() {
  Reflect.construct(Thrower, []);
});
check(function listOfTwo() {
  Reflect.construct(Thrower, [1, 2]);
});
check(function listWithHole() {
  Reflect.construct(Thrower, [1, , 2]);
});
check(function listWithSpread() {
  Reflect.construct(Thrower, [...[1]]);
});
check(function listFromCall() {
  Reflect.construct(Thrower, pass([]));
});
check(function arrayLike() {
  Reflect.construct(Thrower, { length: 0 });
});
check(function argumentsObject() {
  Reflect.construct(Thrower, arguments);
});
check(function newTarget() {
  Reflect.construct(Thrower, [], Object);
});
check(function newTargetFromCall() {
  Reflect.construct(Thrower, [], pass(Thrower));
});
check(function newTargetClass() {
  Reflect.construct(Thrower, [], class {});
});
check(function targetFromCall() {
  Reflect.construct(pass(Thrower), []);
});
check(function fourArguments() {
  Reflect.construct(Thrower, [], Thrower, 1);
});
check(function computedKey() {
  Reflect["construct"](Thrower, []);
});
check(function optionalCall() {
  Reflect.construct?.(Thrower, []);
});
check(function optionalMember() {
  Reflect?.construct(Thrower, []);
});
check(function classTarget() {
  Reflect.construct(
    class {
      constructor() {
        fail();
      }
    },
    [1],
  );
});
check(function functionTarget() {
  Reflect.construct(function () {
    fail();
  }, []);
});
check(function nativeTarget() {
  Reflect.construct(Map, [{ [Symbol.iterator]: fail }]);
});
check(function errorTarget() {
  Reflect.construct(Error, [{ toString: fail }]);
});
check(function lengthGetter() {
  Reflect.construct(Thrower, {
    get length() {
      return fail();
    },
  });
});
check(function elementGetter() {
  Reflect.construct(Thrower, {
    length: 1,
    get 0() {
      return fail();
    },
  });
});
check(function returned() {
  return Reflect.construct(Thrower, []);
});
check(function stored() {
  const made = Reflect.construct(Thrower, []);
  pass(made);
});
check(function asArgument() {
  pass(Reflect.construct(Thrower, []));
});
check(function inCallback() {
  [1].map(() => Reflect.construct(Thrower, []));
});
check(function inDerivedConstructor() {
  class Derived extends Thrower {
    constructor() {
      return Reflect.construct(Thrower, [], new.target);
    }
  }
  new Derived();
});
check(function oneArgument() {
  Reflect.construct(Thrower);
});
check(function listIsNumber() {
  Reflect.construct(Thrower, 1);
});
check(function targetIsNumber() {
  Reflect.construct(1, []);
});
check(function targetIsArrow() {
  Reflect.construct(() => {}, []);
});
check(function newTargetIsNumber() {
  Reflect.construct(Thrower, [], 1);
});
check(function newTargetIsArrow() {
  Reflect.construct(Thrower, [], () => {});
});
function Point(x, y) {
  this.x = x;
  this.y = y;
}
console.log(JSON.stringify(Reflect.construct(Point, [1, 2])), Reflect.construct(Point, [1, 2]) instanceof Point);
console.log(
  JSON.stringify(Reflect.construct(Point, { length: 2, 0: 3, 1: 4 })),
  Object.getPrototypeOf(Reflect.construct(Point, [], Map)) === Map.prototype,
);
console.log(
  Reflect.construct(
    function () {
      return new.target;
    },
    [],
    Set,
  ) === Set,
  Reflect.construct(Array, [3]).length,
  Reflect.construct(Date, [0]).getTime(),
);
