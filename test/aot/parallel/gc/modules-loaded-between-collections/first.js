export const name = "first";
export const list = [1, 2, { three: 3 }];
export const where = () => import.meta.url.replace(/^.*[\\/]/, "") + ":" + typeof import.meta.dirname;
export let count = 0;
export function bump() { return ++count > 0 ? "bumped" : "never"; }
