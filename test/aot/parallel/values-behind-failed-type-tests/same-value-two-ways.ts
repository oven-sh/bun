const out: unknown[] = [];
function both(value: any, flag: boolean) {
  let picked = value;
  if (flag) {
    if (value === undefined) picked = "default";
  }
  out.push(picked);
  return picked;
}
console.log(both(undefined, true), both(undefined, false), both(1, true), both(null, true), both(null, false));
function rejoin(value: any) {
  if (typeof value !== "string") out.push("not a string");
  out.push(value);
  return value;
}
console.log(rejoin("s"), rejoin(3), rejoin(undefined));
console.log(out.map(String).join());
