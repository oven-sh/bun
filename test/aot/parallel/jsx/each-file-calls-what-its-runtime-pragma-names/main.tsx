// Reference: bun build --compile
// `@jsxRuntime react-jsx` switches development off for its file and `react-jsxdev` switches it on, whatever the build is told.
// @jsxImportSource ./tiny
// @jsxRuntime react-jsx
import { other } from "./other";
console.log(<a />, <a key="k" />, <a>{1}{2}</a>, <></>);
console.log(other);
