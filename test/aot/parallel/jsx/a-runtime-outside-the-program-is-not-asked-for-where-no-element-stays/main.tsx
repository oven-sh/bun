// Reference: bun build --compile
// Flags: --external made-elements/jsx-runtime --external made-elements/jsx-dev-runtime --external made-elements
// @jsxImportSource made-elements
// @ts-expect-error
const unused = <a />;
function dead() {
  const props = {};
  return <a {...props} key="k" />;
}
console.log("only this");
