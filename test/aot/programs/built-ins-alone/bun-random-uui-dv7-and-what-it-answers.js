const first = new Date(86400000.5);
const second = new Date(86400000.5);
const result = Bun.randomUUIDv7(first, second);
console.log(typeof result);
