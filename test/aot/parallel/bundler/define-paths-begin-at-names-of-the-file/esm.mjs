export let count = 1;
export function bump() { count++; }
export default { level: 2, holder() { return this.level; } };
export const module = "./define-paths-begin-at-names-of-the-file/cjs.cjs";
