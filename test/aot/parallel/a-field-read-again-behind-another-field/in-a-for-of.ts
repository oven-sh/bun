interface Span { start: number; end: number | null; depth: number; value: number }
function pick(spans: Span[], at: number): number {
  let found = 0, best = -1;
  for (const span of spans) { if (span.depth > best) { found = span.value; best = span.depth; } }
  return found + best;
}
(globalThis as any).kept = pick;
const spans: Span[] = [{ start: 0, end: null, depth: 0, value: 1 }, { start: 2, end: 9, depth: 1, value: 2 }, { start: 3, end: 5, depth: 2, value: 3 }];
console.log(pick(spans, 1), pick(spans, 4), pick(spans, 7), pick(spans, 11));
