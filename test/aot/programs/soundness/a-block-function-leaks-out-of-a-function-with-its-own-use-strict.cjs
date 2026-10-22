function strict() {
  "use strict";
  function f() { return 1; }
  { function f() { return 2; } }
  return f();
}
console.log(strict());
