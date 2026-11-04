Bun.argv[0] = 5;
const a = process.argv[0];
console.log(typeof a, a?.length, JSON.stringify([a]), `${a}|`);
