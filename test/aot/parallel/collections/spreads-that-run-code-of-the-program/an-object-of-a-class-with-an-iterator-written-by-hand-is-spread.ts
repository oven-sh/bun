const seen: string[] = [];
class Range {
  constructor(public limit: number) {}
  [Symbol.iterator]() { seen.push("open"); let i = 0; const limit = this.limit; return { get next() { seen.push("read next"); return () => { seen.push("step"); return i < limit ? { done: false, value: i++ } : { done: true, value: "dropped" }; }; }, return() { seen.push("return"); return {}; } }; }
}
console.log([...new Range(3)].join(), seen.join());
