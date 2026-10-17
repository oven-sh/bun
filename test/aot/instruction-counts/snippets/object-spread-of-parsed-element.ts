// copies parsed objects with a spread that replaces one number; nothing reads the copies by field
type Span = { start: number; end: number; label: string };
const operations = 100;
const makeSample = (): Span => ({ start: 0, end: 1, label: "sample" });
const spans: Span[] = JSON.parse("[" + Array.from({ length: operations }, (_, i) => `{"start":${i},"end":${i + 1},"label":"l${i}"}`).join() + "]");
const move = (spans: readonly Span[], by: number) => spans.map(span => ({ ...span, start: span.start + by }));
let moved: unknown[] = [makeSample()];

kernel: {
  moved = move(spans, 3);
}

console.log(JSON.stringify(moved[7]), moved.length);
