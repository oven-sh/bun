// A digit is carried into a list behind the loop that stores the digits below it. The loop has two copies that each test the kind of the list's storage for themselves.
function product(n: number, m: number): string {
  const digits: number[] = [];
  let i: number, k: number;
  for (i = n + m; i--; ) digits.push(0);
  for (i = m; --i >= 0; ) {
    let carry = 0;
    for (k = n + i; k > i; ) {
      const sum = digits[k]! + i * k + carry;
      digits[k--] = sum % 10 | 0;
      carry = sum / 10 | 0;
    }
    digits[k] = (digits[k]! + carry) % 10 | 0;
  }
  return digits.join();
}
for (const n of JSON.parse("[1,3,7]")) for (const m of JSON.parse("[1,2,5]")) console.log(product(n, m));
