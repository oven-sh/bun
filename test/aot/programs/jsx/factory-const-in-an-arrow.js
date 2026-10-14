// JSX with the classic runtime: factory const in an arrow.
/** @jsxRuntime classic */ /** @jsx h */
const h = t => t;
console.log((() => <a />)());
