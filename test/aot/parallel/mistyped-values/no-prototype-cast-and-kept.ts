// Flags: --aot-check=verify-each-pass
// The parameter is both kept in a variable that every store is held to and cast to a list of numbers.
let held: any;
function table(values: unknown[] | string | null, keeps: boolean) {
  if (values instanceof Array) { held = values; } else { held = values; }
  return keeps ? (values as number[]) : null;
}
for (const lie of [Object.create(null), [1, 2], "ab", null, 5, Object.create(Array.prototype)]) {
  const made = table(lie as any, true);
  console.log(typeof held, Array.isArray(held) + "", typeof made, made === held ? "same" : "other", made == null ? "none" : typeof made.length);
}
export {};
