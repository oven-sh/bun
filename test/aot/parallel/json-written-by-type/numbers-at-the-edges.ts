// numbers in members, straight and in a loop: -0, NaN, the infinities, 1e21, 2 ** 53 and its neighbors, the ends of int32, fractions, the smallest and the largest
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Row = { n: number; whole: number };
function write(row: Row): string {
  return JSON.stringify(row);
}
function writeWhole(n: number): string {
  return JSON.stringify({ n: n | 0, unsigned: n >>> 0, product: (n | 0) * 4096 });
}
const numbers = [0, -0, 1, -1, 9999, 10000, 99999999, 100000000, NaN, Infinity, -Infinity, 1e21, 1e-7, 2 ** 53, 2 ** 53 - 1, -(2 ** 53), 2 ** 31 - 1, 2 ** 31, -(2 ** 31), 0.1, 1.5, 5e-324, 1.7976931348623157e308, 123456789012345680000];
for (let i = 0; i < numbers.length; i++) console.log(write({ n: numbers[i], whole: i }), writeWhole(numbers[i]));
