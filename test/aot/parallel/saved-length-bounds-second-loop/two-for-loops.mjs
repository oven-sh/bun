// Under: --aot-check=Validate: the code verifier rejected this loop because another array's length was read before the capacity was reserved
const array = [4, 1, 3, 2];
const output = [];
for (let i1 = 0; i1 < array.length; i1++) {
  output[i1 + 1] = 0;
}
for (let i2 = 0, length2 = array.length; i2 < length2; i2++) {
  output[i2] = -1;
}
console.log(output.join());
