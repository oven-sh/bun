const css = (templ) => templ.toString();
const fooNoBracesUTF8 = css`
  before
  /* */
  after
`;
const fooNoBracesUT16 = css`
  before
  \uD83D\uDE43
  after
`;
const fooUTF8 = css`
    before
  ${true}
    after

`;
const fooUTF16 = css`
    before
    \uD83D\uDE43 ${true}
    after

`;
const templateLiteralWhichDefinesAFunction = ((...args) => args[args.length - 1]().toString())`
    before
    \uD83D\uDE43 ${() => true}
    after

`;
export function test() {
  for (let foo of [fooNoBracesUT16, fooNoBracesUTF8, fooUTF16, fooUTF8]) {
    console.assert(foo.includes("before"), `Expected ${foo} to include "before"`);
    console.assert(foo.includes("after"), `Expected ${foo} to include "after"`);
  }
  console.assert(templateLiteralWhichDefinesAFunction.includes("true"), "Expected fooFunction to include 'true'");
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/template-literal.js.map
