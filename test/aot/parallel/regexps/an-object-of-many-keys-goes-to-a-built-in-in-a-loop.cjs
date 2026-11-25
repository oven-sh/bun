const wide = {};
for (let key = 0; key < 100000; key++) wide["k" + key] = key;
let sum = 0;
for (let turn = 0; turn < 3000000; turn++) sum += Math.cbrt(wide);
console.log(sum);
console.log(new RegExp("a" + "b".toLowerCase()).source);
