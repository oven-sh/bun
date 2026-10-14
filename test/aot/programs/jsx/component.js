// Classic JSX runtime with an `@jsx` pragma: a function component.
/** @jsxRuntime classic */ /** @jsx h */
const h = (t, p) => typeof t === "function" ? t(p) : t;
const C = () => <b />;
console.log((() => <C />)());
