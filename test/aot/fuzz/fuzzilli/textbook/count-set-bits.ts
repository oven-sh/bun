function bits(value: number): number {
  let count = 0;
  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}
console.log(bits(Number("255")), bits(Number("-1")), bits(0), bits(Number("1024")));
