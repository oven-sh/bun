// Nothing in the loops can throw: the turns of the inner loop are laid out as without the try.
function add(n) {
  let total = 0;
  try {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 100; j++) total = (total + j * i) | 0;
    }
  } catch (error) {}
  return total;
}
let sum = 0;
for (let round = 0; round < 3; round++) sum = (sum + add(1000) + add(7) + add(0)) | 0;
console.log(sum);
