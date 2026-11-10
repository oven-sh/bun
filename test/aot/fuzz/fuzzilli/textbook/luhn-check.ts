function isValid(digits: string): boolean {
  let sum = 0;
  let second = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (second) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    second = !second;
  }
  return sum % 10 === 0;
}
console.log(isValid(JSON.parse('"4539578763621486"')), isValid(JSON.parse('"4539578763621487"')));
