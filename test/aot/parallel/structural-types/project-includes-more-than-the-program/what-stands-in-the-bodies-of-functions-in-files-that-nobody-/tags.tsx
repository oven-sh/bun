import { a } from "./a";
declare namespace JSX { interface IntrinsicElements { p: {}; } }
export function f() { return <p>don't {a} http://x }</p>; }
export const after = 1;
