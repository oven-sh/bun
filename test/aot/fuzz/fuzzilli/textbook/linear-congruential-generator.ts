function drawn(seed: number, count: number): number[] {
  const out: number[] = [];
  let state = seed >>> 0;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push(state % 100);
  }
  return out;
}
console.log(drawn(Number("42"), 8).join());
