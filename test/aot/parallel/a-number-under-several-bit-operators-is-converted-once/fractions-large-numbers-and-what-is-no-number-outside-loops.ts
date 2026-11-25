export {};
function mix(x: number): number { return ((x >>> 2) | (x << 30)) ^ ((x >>> 13) | (x << 19)) ^ ((x >>> 22) | (x << 10)); }
function both(x: number, y: number): number { return (x & y) ^ (x | y) ^ (~x) ^ (y >> 3) ^ (x >>> 1); }
function once(x: number): number { return x | 0; }
function mixed(x: number, flag: boolean): number { return flag ? (x << 1) ^ (x >> 1) : (x & 255) + (x >>> 24); }
const numbers: number[] = JSON.parse("[0, 0.5, -0.5, 1.5, -1.5, 2147483647, 2147483648, 2147483648.5, -2147483648, -2147483649.25, 4294967295, 4294967296, 4294967297.75, 9007199254740991, -9007199254740991, 1e21, -1e21, 1e300, 5e-324]");
numbers.push(NaN, Infinity, -Infinity, -0);
const said: string[] = [];
said.push(String(mix(numbers[0])), String(mix(numbers[1])), String(mix(numbers[7])), String(mix(numbers[12])), String(mix(numbers[15])), String(mix(numbers[19])), String(mix(numbers[20])), String(mix(numbers[22])));
said.push(String(both(numbers[3], numbers[9])), String(both(numbers[13], numbers[4])), String(both(numbers[21], numbers[17])), String(once(numbers[11])), String(once(numbers[18])), String(mixed(numbers[6], true)), String(mixed(numbers[6], false)));
console.log(said.join());
for (const x of numbers) console.log(mix(x), once(x), mixed(x, true), mixed(x, false), both(x, numbers[2]), both(numbers[10], x));
