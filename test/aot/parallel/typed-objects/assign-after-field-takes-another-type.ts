// A field that held a function takes a number, then Object.assign and a spread copy the object.
function assigned(): void {
  let o: any = { m: 1, n: () => 1 };
  console.log("n" in o ? typeof o.n : "lost");
  o.n++;
  o = Object.assign({}, o);
  console.log(o.n, "n" in o, Object.keys(o).join());
}
function spread(): void {
  let o: any = { m: 1, n: () => 1 };
  console.log("n" in o ? typeof o.n : "lost");
  o.n = "text";
  o = { ...o };
  console.log(o.n, "n" in o, Object.keys(o).join());
}
function listed(): void {
  const o: any = { m: 1, n: () => 1 };
  console.log("n" in o ? typeof o.n : "lost");
  o.m = { deep: 1 };
  console.log(JSON.stringify(Object.entries(o).map(([k, v]) => [k, typeof v])), JSON.stringify(o));
}
assigned();
spread();
listed();
