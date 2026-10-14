// Classic JSX runtime: the factory named by the `@jsx` pragma captures a variable.
/** @jsxRuntime classic */ /** @jsx h */
const tag = "!"; const h = t => t + tag;
console.log((() => <a />)());
