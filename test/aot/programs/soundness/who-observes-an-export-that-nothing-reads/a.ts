export const used = 1;
export const unused = { deep: 2 };
export function neverCalled() { return "called after all"; }
export let changing = 0;
export function bump() { changing++; }
export default class Hidden { tag = "hidden"; }
