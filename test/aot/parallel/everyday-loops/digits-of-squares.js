// Digits of squares pushed from the last to the first, with a mark behind each
function digits(from) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    let rest = (from + i) * (from + i);
    for (let k = 0; k < 4; k++) {
      out.push(rest % 10);
      rest = (rest / 10) | 0;
    }
    out.push(-1 - rest);
  }
  return out.join("");
}
console.log(digits(1));
console.log(digits(31));
console.log(digits(100));
