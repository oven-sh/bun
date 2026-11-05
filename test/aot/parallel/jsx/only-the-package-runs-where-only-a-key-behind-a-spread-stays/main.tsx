// Reference: bun build --compile
// @jsxImportSource ./tiny
const unused = <p>dead</p>;
const props = {};
console.log(JSON.stringify(<a {...props} key="k" />));
