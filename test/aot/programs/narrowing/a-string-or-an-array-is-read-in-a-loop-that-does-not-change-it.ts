function lengths(value: string | number[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) {
    r = (r + value.length) | 0;
    const unit = value[i & 3];
    r = (r + (typeof unit === "string" ? unit.charCodeAt(0) : unit ?? -1)) | 0;
    r ^= value.length << 3;
  }
  return r;
}
console.log(lengths("abcd", 5), lengths([1, 2, 3], 6), lengths("", 3), lengths([], 2));
