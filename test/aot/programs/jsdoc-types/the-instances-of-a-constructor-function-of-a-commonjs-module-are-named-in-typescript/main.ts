type All = typeof import("./library.cjs");

function show(size: All["size"], thing: InstanceType<All["Thing"]>): string {
  return size + " " + thing.a;
}
console.log(show(3, { a: 1 }));
