interface Point {
  x: number;
  y: number;
  tag: string;
}

let trace = "";

function record(a: Point, b: Point, c: Point, d: Point, e: number, f: string): number {
  trace += a.tag + b.tag + c.tag + d.tag + e + f + ";";
  return a.x + b.y + c.x + d.y + e;
}

function manyAlive(a: Point, b: Point, c: Point, d: Point, e: Point, f: Point, g: number, h: string): string {
  let sum = 0;
  let text = "";
  for (let i = 0; i < 5; i++) {
    sum += a.x * i + b.y - c.x + d.y * 2 + e.x - f.y + g;
    text += a.tag.length + b.tag.length + c.tag.length;
    if (i === 2) sum += record(a, b, c, d, g, h);
    if (i === 3) sum += record(f, e, d, c, i, h);
    sum += e.y + f.x;
  }
  return sum + "/" + text + "/" + a.tag + b.tag + c.tag + d.tag + e.tag + f.tag + g + h;
}

function onlyPassedAlong(a: Point, b: Point, c: Point, d: Point, e: number, f: string, hot: number[]): number {
  let total = 0;
  for (let i = 0; i < hot.length; i++) {
    const value = hot[i];
    total += value * value + (value >> 1) - (value & 3) + i;
  }
  return total + record(a, b, c, d, e, f) + record(d, c, b, a, e + 1, f);
}

function integersAndDoubles(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number {
  const first = a * b + c * d + e * f + g * h + i * j;
  const second = (a | 0) + (c | 0) + (e | 0) + (g | 0) + (i | 0);
  trace += first.toFixed(2) + ":" + second + ";";
  return first - second + a - b + c - d + e - f + g - h + i - j;
}

function swapped(a: Point, b: Point, c: Point, d: Point, rounds: number): string {
  let out = "";
  for (let i = 0; i < rounds; i++) {
    const kept = a;
    a = b;
    b = c;
    c = d;
    d = kept;
    out += record(a, b, c, d, i, "s");
  }
  return out + a.tag + b.tag + c.tag + d.tag;
}

const points: Point[] = [];
for (let i = 0; i < 6; i++) points.push({ x: i + 0.5, y: i * 2, tag: "p" + i });

console.log(manyAlive(points[0], points[1], points[2], points[3], points[4], points[5], 7, "end"));
console.log(onlyPassedAlong(points[5], points[4], points[3], points[2], 9, "z", [3, 1, 4, 1, 5, 9, 2, 6]));
console.log(integersAndDoubles(1.5, 2, 3.25, 4, 5.75, 6, 7.125, 8, 9.5, 10));
console.log(swapped(points[0], points[1], points[2], points[3], 6));
console.log(trace.length, trace.slice(0, 90));
