function inBase(number, base) {
  let out = "";
  do {
    out = "0123456789abcdef"[number % base] + out;
    number = Math.floor(number / base);
  } while (number > 0);
  return out;
}
console.log(inBase(Number("255"), 16), inBase(Number("5"), 2), inBase(0, 8));
