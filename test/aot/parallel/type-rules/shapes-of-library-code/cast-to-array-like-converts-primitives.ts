function isArrayLike(value?: any): boolean {
  return value != null && typeof value !== "function" && typeof (value as ArrayLike<unknown>).length === "number";
}
function items(collection: unknown): string[] {
  const list = collection as ArrayLike<unknown>;
  return Array.from(list).map(String);
}
console.log(isArrayLike(false), isArrayLike(0), isArrayLike(123), isArrayLike("ab"));
console.log(items(123).join(), items(true).join(), items("ab").join());
