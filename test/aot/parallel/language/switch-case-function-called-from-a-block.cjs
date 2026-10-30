"use strict";
function f(code) {
  switch (code) {
    case 1:
      function helper(n) {
        return n + 1;
      }
      if (code) {
        return helper(1);
      }
  }
  return 0;
}
console.log(f(1), f(2));
