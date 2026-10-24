import * as b from "./cyc_b";
export const fromA: string = ["a"].join();
export function lookAtB(): string { return Object.keys([b][0]).join() + ":" + [b][0].fromB; }
