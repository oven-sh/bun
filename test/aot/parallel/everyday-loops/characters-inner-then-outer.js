// Characters of a text pushed by the inner loop, a number behind it
function codes(text) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(text.charCodeAt(k + i));
    }
    out.push(text.length * i);
  }
  return out.join();
}
console.log(codes("abcd"));
console.log(codes("é😀"));
console.log(codes("xyzw"), codes(""));
