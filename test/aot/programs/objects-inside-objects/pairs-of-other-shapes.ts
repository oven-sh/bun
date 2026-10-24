// Three levels, two inner objects in one outer object, one pair made in several places, classes, inner objects of one and of eight fields, numbers and references mixed.
import { edenGC, fullGC } from "bun:jsc";

type C = { value: number; name: string };
type B = { c: C; weight: number };
type A = { b: B; tag: number };
type Two = { left: C; right: C; between: string };
type Eight = { wide: { a: number; b: string; c: number[]; d: number; e: string | null; f: object | null; g: number; h: boolean }; tag: number };
type One = { only: { ref: number[] } };
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } norm(): number { return this.x * this.x + this.y * this.y; } }
class Segment { from: Point; to: Point; name: string; constructor(i: number) { this.from = new Point(i, i + 1); this.to = new Point(i + 2, i + 3); this.name = "segment" + i; } length(): number { return this.to.norm() - this.from.norm(); } }

const three: A[] = [], two: Two[] = [], eight: Eight[] = [], one: One[] = [], segments: Segment[] = [];
function fill(rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      three.push({ b: { c: { value: i, name: "c" + i }, weight: i / 2 }, tag: i });
      two.push({ left: { value: i, name: "left" + i }, right: { value: -i, name: "right" + i }, between: "between" + i });
      eight.push({ wide: { a: i, b: "b" + i, c: [i], d: i + 0.5, e: i % 2 ? "e" + i : null, f: i % 3 ? [i, i] : null, g: -i, h: i % 2 === 0 }, tag: i });
      one.push({ only: { ref: [i, i * 2] } });
      segments.push(new Segment(i));
    }
  }
}
function elsewhere(i: number): Two { return { left: { value: i, name: "other left" + i }, right: { value: -i, name: "other right" + i }, between: "elsewhere" }; }
function oneGiven(i: number, given: C): Two { return { left: given, right: { value: -i, name: "beside a given one" }, between: "given" }; }

const kept: unknown[] = [];
function keep(value: unknown): void { kept.push(value); }
function collect(step: number): void { if (step % 2) edenGC(); else fullGC(); }

let check = 0;
function mix(value: number): void { check = (check * 31 + value) | 0; }
function look(): void {
  for (const a of three) mix(a.b.c.value + a.b.c.name.length + a.b.weight * 2 + a.tag);
  for (const t of two) mix(t.left.value * 3 + t.right.value + t.left.name.length + t.right.name.length + t.between.length);
  for (const e of eight) mix(e.wide.a + e.wide.b.length + e.wide.c[0] + e.wide.d * 2 + (e.wide.e ? e.wide.e.length : 7) + (e.wide.f ? 1 : 2) + e.wide.g + (e.wide.h ? 1 : 0));
  for (const o of one) mix(o.only.ref[0] + o.only.ref[1]);
  for (const s of segments) mix(s.length() + s.name.length);
}

for (let round = 0; round < 4; round++) {
  fill(6, 6);
  two.push(elsewhere(round), oneGiven(round, two[round].left), oneGiven(round, { value: round, name: "made for it" }));
  collect(round);
  look();
  const i = round * 5;
  keep(three[i].b); keep(three[i + 1].b.c); keep(two[i].left); keep(two[i + 1].right); keep(eight[i].wide); keep(one[i].only); keep(segments[i].from); keep(segments[i + 1].to);
  three[i + 2].b.c.name = "stored" + round; three[i + 2].b = { c: { value: -1, name: "new" }, weight: 0 }; three[i + 3].b.c = { value: -2, name: "newer" };
  two[i + 2].left = two[i + 3].right; two[i + 3].right = { value: 0, name: "fresh" };
  eight[i + 2].wide.f = { round }; eight[i + 2].wide.e = "late" + round; eight[i + 2].wide.c = [round, round];
  segments[i + 2].from = segments[i + 3].to; segments[i + 3].to.x = 100 + round;
  collect(round + 1);
  look();
  three.splice(0, 3); two.splice(1, 3); eight.splice(2, 3); one.splice(3, 3); segments.splice(4, 3);
  collect(round);
  look();
}
console.log(check, kept.length, JSON.stringify(kept).length, JSON.stringify(kept.slice(0, 8)));
