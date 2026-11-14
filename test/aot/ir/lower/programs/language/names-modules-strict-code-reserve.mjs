// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1214 3
// DIAGNOSTIC: TS1262 6

// Function expressions that nothing reads, and variables inside such functions, have names that a module or strict code reserves: early errors of the language, so the build stops.
// Plain Bun prints another output.
(function package() {
  "use strict";
});
(function yield() {
  "use strict";
});
(function await() {});
(function* await() {});
async function f() {
  (function await() {});
}
function* g() {
  (function yield() {});
}
class A {
  static {
    (function await() {});
  }
}
class B {
  static {
    (function () {
      var await;
    });
  }
}
class C {
  static {
    (() => {
      var await;
    });
  }
}
console.log("ran");
