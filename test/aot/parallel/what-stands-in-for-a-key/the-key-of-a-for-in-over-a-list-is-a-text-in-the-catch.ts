function run(list: number[], table: any) {
  var failed: any[] = [];
  try { for (var key in list) table[key](); }
  catch (error) { failed.push(key!, typeof key!, key! === "1", (key! as any) + 1); }
  return failed;
}
console.log(JSON.stringify(run(JSON.parse("[7,8,9]"), { 0() {}, 1() { throw new Error("no"); }, 2() {} })));
export {};
