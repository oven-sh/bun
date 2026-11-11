interface Entry { id: number; cache?: string }
function bare(id: number): Entry { return { id }; }
function warm(id: number, cache: string): Entry { return { id, cache }; }
function hide(e: Entry, v: string): void { Object.defineProperty(e, "cache", { value: v }); }
function run() {
  const a = bare(1), b = warm(2, "warm");
  hide(a, "cold");
  console.log(JSON.stringify([a, b]), Object.keys(b).join(), a.cache, b.cache);
}
run();
