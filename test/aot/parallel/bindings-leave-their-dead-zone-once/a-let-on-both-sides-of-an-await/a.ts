await null;
export let count = process.argv.length > 100 ? 5 : 1;
export function bump() { count = count + 10; }
