function run(list: number[], table: any) {
  var key: any; const seen: string[] = [];
  try { try { for (key in list) table[key](); } finally { seen.push(typeof key); } } catch {}
  return seen;
}
console.log(JSON.stringify(run(JSON.parse("[7,8,9]"), { 0() {}, 1() { throw new Error("no"); }, 2() {} })));
export {};
