interface Entry {
  id: number;
  cache?: string;
}
function bare(id: number): Entry {
  return { id };
}
function warm(id: number, cache: string): Entry {
  return { id, cache };
}
function run() {
  const a = bare(1);
  const b = warm(2, "warm");
  console.log(JSON.stringify([a, b]), Object.keys(b).join(), a.cache, b.cache);
}
run();
