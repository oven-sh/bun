class Picture {
  pixels = new Uint8ClampedArray(8);
  limit = 300;
  color(at: number, value: number): number {
    const p = this.pixels;
    if (value === this.limit) {
      p[at] = p[1] = p[2] = 0;
    } else {
      const t = value / this.limit;
      p[at] = value;
      p[1] = 15 * (1 - t) * (1 - t) * t * t * 255;
      p[2] = 8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255;
    }
    p[5] = value * 1.25;
    return p[at];
  }
}
const picture = new Picture();
const other = new Picture();
const values = [0.5, 1.5, 2.5, 254.5, 255.5, -0.5, -1, 256, NaN, Infinity, -Infinity, -0, 5e-324, 0.49999999999999994, 254.49999999999997, 300];
let text = "";
values.forEach((value, i) => {
  other.color(i, value + 1);
  text += picture.color(i, value) + ",";
});
console.log(text);
console.log(Array.from(picture.pixels).join(), Array.from(other.pixels).join());
console.log(picture.color(8, 1), picture.color(-1, 1), picture.color(0.5, 1), picture.color(-0, 2.5));
