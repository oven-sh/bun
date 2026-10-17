// Classic JSX runtime: a fragment with an `@jsxFrag` pragma.
/** @jsxRuntime classic */ /** @jsx h */ /** @jsxFrag F */
const F = "fragment"; const h = (t) => t;
console.log((() => <></>)());
