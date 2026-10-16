// parses decimal numbers out of a string by charCodeAt, the character held in a variable that goes round the loops
const operations = 100;
const pattern = "123.456,7.25,";
let text = "";
for (let i = 0; i < operations; i++) text += pattern[i % pattern.length];
let total = 0;

kernel: {
  let sum = 0;
  let i = 0;
  while (i < text.length) {
    let value = 0;
    let c = text.charCodeAt(i);
    while (c >= 48 && c <= 57) {
      value = value * 10 + (c - 48);
      i++;
      c = i < text.length ? text.charCodeAt(i) : 0;
    }
    if (c === 46) {
      i++;
      let scale = 0.1;
      c = i < text.length ? text.charCodeAt(i) : 0;
      while (c >= 48 && c <= 57) {
        value += (c - 48) * scale;
        scale *= 0.1;
        i++;
        c = i < text.length ? text.charCodeAt(i) : 0;
      }
    }
    sum += value;
    i++;
  }
  total += sum;
}

console.log(total);
