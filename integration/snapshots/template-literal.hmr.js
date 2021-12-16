import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
Bun.activate(false);

var hmr = new HMR(2201713056, "template-literal.js"), exports = hmr.exports;
(hmr._load = function() {
  const css = (templ) => templ.toString();
  const fooNoBracesUTF8 = css`
  before
  /* */
  after
`;
  const fooNoBracesUT16 = css`
  before
  🙃
  after
`;
  const fooUTF8 = css`
    before
  ${true}
    after

`;
  const fooUTF16 = css`
    before
    🙃 ${true}
    after

`;
  const templateLiteralWhichDefinesAFunction = ((...args) => args[args.length - 1]().toString())`
    before
    🙃 ${() => true}
    after

`;
  function test() {
    for (let foo of [fooNoBracesUT16, fooNoBracesUTF8, fooUTF16, fooUTF8]) {
      console.assert(foo.includes("before"), `Expected ${foo} to include "before"`);
      console.assert(foo.includes("after"), `Expected ${foo} to include "after"`);
    }
    console.assert(templateLiteralWhichDefinesAFunction.includes("true"), "Expected fooFunction to include 'true'");
    return testDone(import.meta.url);
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
