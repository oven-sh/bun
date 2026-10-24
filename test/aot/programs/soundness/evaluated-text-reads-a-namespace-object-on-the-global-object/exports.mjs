export const used = 1;
export const unread = "kept";
export function neverCalled() { return "called"; }
export let counter = 0;
export function bump() { return ++counter; }
export const holder = { n: 21, list: [1, 2] };
export function twice() { return holder.n * 2; }
export function total() { let s = 0; for (let i = 0; i < holder.list.length; i++) s += holder.list[i]; return s; }
export default class Unused { }
