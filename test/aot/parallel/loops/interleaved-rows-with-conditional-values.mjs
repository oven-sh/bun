// A conditional value inside an inner loop that runs several strips side by side.
const samples = new Array(768).fill(0.5);
for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.7) * 2.5;
const k = 0.31;

function magnitude(input, output) {
  for (let s = 0; s + 16 <= input.length; s += 16) {
    let carried = 0;
    let j = s;
    for (let i = 0; i < 16; i++) {
      const value = input[j];
      carried = carried * 0.9 + value * 0.1 + carried * value * 0.01;
      output[j] = value > 0 ? carried : -carried;
      j++;
    }
  }
}

function shortCircuit(input, output) {
  for (let s = 0; s + 32 <= input.length; s += 32) {
    let carried = 0;
    let j = s;
    for (let i = 0; i < 32; i++) {
      const value = input[j] + 0.1;
      carried = value * k + carried * k + k * k;
      const large = carried > 0.5 && carried;
      output[j] = carried + (large || 0.1);
      j += 1;
    }
  }
}

function checksum(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum = sum * 1.0001 + values[i];
  return sum;
}

const output = new Array(768).fill(0.5);
magnitude(samples, output);
console.log(checksum(output), output[3], output[767]);
shortCircuit(samples, output);
console.log(checksum(output), output[3], output[767]);
magnitude(output, output);
console.log(checksum(output), output[3], output[767]);
