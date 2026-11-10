function added(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + 1);
  let carry = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const sum = a[i] + b[i] + carry;
    out[i + 1] = sum & 255;
    carry = sum >> 8;
  }
  out[0] = carry;
  return out;
}
console.log(added(Uint8Array.of(255, 200, 100), Uint8Array.of(1, 100, 200)).join());
