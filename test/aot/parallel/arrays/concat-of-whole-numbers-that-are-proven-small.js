// The number is proven to fit a small integer, and what flow says of the list's contents is a number of any size: the readers test for double storage, and the list is made so.
// COUNT: operation:operationAOTConvertToDoubleStorage = 0
const xs = [1, 2, 3, 4, 5, 6, 7, 8];
function turn(i) {
  const b = xs.concat(i * 3);
  return (b[i & 3] ?? 0) + (b[8] ?? 0);
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum = (sum + turn(i)) | 0;
console.log(sum, xs.concat(5), xs.concat(5).length, xs.concat(1.5)[8], xs.concat("a")[8]);
