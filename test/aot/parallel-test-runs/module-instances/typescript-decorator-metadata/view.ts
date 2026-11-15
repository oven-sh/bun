import { Kind, mark } from "./leaf.ts";
const make = () => { class T { @mark method(k: Kind) { return 1; } @mark field: Kind; }; return (T.prototype as any).marks.join("+"); };
export const view = () => [Kind.w, make(), eval("Kind.w"), (0, eval)("1")].join();
