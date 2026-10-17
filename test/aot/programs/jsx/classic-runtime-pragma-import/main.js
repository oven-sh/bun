// Classic JSX runtime: the `@jsx` pragma names a named import from a CommonJS module.
/** @jsxRuntime classic */
/** @jsx h */
import { createElement as h } from "./r.cjs";
console.log(<a />);
