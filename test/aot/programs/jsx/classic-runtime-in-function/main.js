// Classic JSX runtime: an element with props and children created inside a function, with `React` imported from a CommonJS module.
/** @jsxRuntime classic */
import React from "./r.cjs";
const f = () => <a k="v">x</a>; console.log(f(), f());
