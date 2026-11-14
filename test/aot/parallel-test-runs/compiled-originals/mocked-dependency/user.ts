import * as x from "./x";
export const go = () => [Object.keys(x).join("+"), (x as any).mark, typeof (x as any).f].join();
