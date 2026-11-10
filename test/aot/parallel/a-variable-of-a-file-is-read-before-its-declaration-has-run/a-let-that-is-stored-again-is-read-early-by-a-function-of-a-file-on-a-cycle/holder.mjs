console.log("holder");
export let count = process.argv.length;
export function bump() { count += 10; }
