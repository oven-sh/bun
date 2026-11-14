function described(value: string | number | number[] | null): string {
  if (value === null) return "nothing";
  if (typeof value === "string") return "text of " + value.length;
  if (typeof value === "number") return "number " + value.toFixed(1);
  return "list of " + value.length;
}
console.log([described(null), described("abc"), described(2), described([1, 2])].join());
