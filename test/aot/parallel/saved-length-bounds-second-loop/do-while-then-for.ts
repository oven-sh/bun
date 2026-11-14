// Under: --aot-check=Validate: the code verifier rejected this loop because another array's length was read before the capacity was reserved
const array: any = [4, 1, 3, 2];
const output: any = [];
let i1 = 0;
do {
  output[i1 + 1] = 0;
  i1++;
} while (i1 < array.length);
for (let i2 = 0, length2 = array.length; i2 < length2; i2++) {
  output[i2] = -1;
}
console.log(output.join());
