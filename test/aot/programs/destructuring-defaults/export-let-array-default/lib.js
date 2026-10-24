const one = () => "one";
export let f = one;
export const first = one;
export function write(V) { f = one; [f = one] = [V]; }
export const call = () => f();
