// Classic JSX runtime: the factory named by the `@jsx` pragma is a `let` that is reassigned between two renders.
/** @jsxRuntime classic */ /** @jsx h */
let h = (t) => "first " + t;
const f = () => <a />;
console.log(f()); h = (t) => "second " + t; console.log(f());
