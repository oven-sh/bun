// Classic JSX runtime: the factory is a `const` declared inside an arrow function.
/** @jsxRuntime classic */ /** @jsx h */
const h = t => t;
console.log((() => <a />)());
