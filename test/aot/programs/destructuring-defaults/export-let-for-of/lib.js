const one = () => "one";
export let f = one;
export const first = one;
export function write(V) { f = one; for ([f = one] of [[V]]) ; }
export const call = () => f();
