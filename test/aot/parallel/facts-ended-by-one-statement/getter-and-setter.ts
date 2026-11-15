const gauge: any = {
  raw: 1,
  get level() {
    return this.raw * 2;
  },
  set level(v: number) {
    this.raw = v + 1;
  },
};
function drive(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    gauge.level = i;
    text += gauge.level + " ";
  }
  return text;
}
console.log(drive(3));
Object.defineProperty(gauge, "level", {
  set(v: number) {
    this.raw = v * 10;
  },
  get() {
    return -this.raw;
  },
});
console.log(drive(3), gauge.raw);
