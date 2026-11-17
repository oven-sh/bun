export const limit = process.argv.length + 40;
export let count = process.argv.length;
export function bump() { count += 10; }
export class Point { constructor(x) { this.x = x + limit; } }
