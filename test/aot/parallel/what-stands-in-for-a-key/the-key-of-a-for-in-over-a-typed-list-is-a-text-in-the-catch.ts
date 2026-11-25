function run(list: string[], table: Record<string, () => void>): string {
  let key = "none";
  try { for (key in list) table[key]!(); } catch { return key + ":" + typeof key + ":" + (key === "1") + ":" + key.length; }
  return "ok";
}
console.log(run(["a", "b", "c"], { 0() {}, 1() { throw new Error("no"); }, 2() {} }));
export {};
