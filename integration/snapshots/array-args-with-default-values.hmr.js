import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
Bun.activate(false);

var hmr = new HMR(3474597122, "array-args-with-default-values.js"), exports = hmr.exports;
(hmr._load = function() {
  var lines;
  const data = () => lines.map(([a = null, b = null, c = null, d = null]) => ({
    a,
    b,
    c,
    d
  }));
  function test() {
    let ran = false;
    lines = [
      [undefined, undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined]
    ];
    for (let foo of data()) {
      console.assert(foo.a === null);
      console.assert(foo.b === null);
      console.assert(foo.c === null);
      console.assert(foo.d === null);
      ran = true;
    }
    console.assert(ran);
    testDone(import.meta.url);
  }
  hmr.exportAll({
    test: () => test
  });
})();
var $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_test = exports.test;
};

export {
  $$hmr_test as test
};
