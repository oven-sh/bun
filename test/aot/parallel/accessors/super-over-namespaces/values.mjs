export let count = 5;
export const text = "some text";
export const change = () => { count++; };
export function hi(x) { return this === undefined ? x : x + 1; }
export let late;
export const fill = value => { late = value; };
export default "default";
