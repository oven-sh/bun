export let value = 1;
export let later;
export function change() { value = "s"; later = function (x) { return typeof x + "!"; }; }
export function fn(x) { return typeof x; }
