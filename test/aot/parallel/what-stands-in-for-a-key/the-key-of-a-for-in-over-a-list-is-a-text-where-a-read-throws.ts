function run(list: any[], holder: any): string {
  let key = "none";
  try { for (key in list) { const value = holder[key].x; if (value > 100) break; } } catch { return key + ":" + typeof key + ":" + (key === "1"); }
  return "ok";
}
console.log(run([1, 2, 3], [{ x: 1 }, null, { x: 2 }]));
export {};
