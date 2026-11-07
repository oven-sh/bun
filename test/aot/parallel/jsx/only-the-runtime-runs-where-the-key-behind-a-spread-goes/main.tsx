// Reference: bun build --compile
// @jsxImportSource ./tiny
function dead() {
  const props = {}; // @ts-expect-error
  return <a {...props} key="k" />;
} // @ts-expect-error
console.log(JSON.stringify(<p>live</p>));
