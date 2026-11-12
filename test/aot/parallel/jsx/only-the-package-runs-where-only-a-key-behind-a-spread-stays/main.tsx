// Reference: bun build --compile
// @jsxImportSource ./tiny
// @ts-expect-error
const unused = <p>dead</p>;
const props = {}; // @ts-expect-error
console.log(JSON.stringify(<a {...props} key="k" />));
