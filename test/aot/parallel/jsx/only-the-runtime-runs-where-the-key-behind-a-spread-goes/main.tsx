// Reference: bun build --compile
// @jsxImportSource ./tiny
function dead() {
  const props = {};
  return <a {...props} key="k" />;
}
console.log(JSON.stringify(<p>live</p>));
