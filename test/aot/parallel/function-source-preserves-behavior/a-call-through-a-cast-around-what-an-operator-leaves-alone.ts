// Flags: --minify-syntax --aot-threads=1
// A cast stands between a call and an operator that leaves one operand alone: what `toString()` gives still calls without the list or the object as `this`.
const holder = {
  m(this: unknown) {
    return this === holder;
  },
};
const cases = {
  as: function () { return (([function (this: unknown) { return Array.isArray(this); }][0] || 0) as any)(); },
  nonNull: function () { return ([function (this: unknown) { return Array.isArray(this); }][0] || 0)!(); },
  satisfies: function () { return (([function (this: unknown) { return Array.isArray(this); }][0] ?? 0) satisfies unknown as any)(); },
  angleBrackets: function () { return (<any>([function (this: unknown) { return Array.isArray(this); }][0] || 0))(); },
  aroundAConditional: function (o: typeof holder) { return ((true ? o.m : 0) as any)(); },
  aroundAnd: function (o: typeof holder) { return ((true && o.m) as any)(); },
  aroundTheOperand: function (o: typeof holder) { return (true ? (o.m as any) : 0)(); },
  nonNullOnTheRead: function () { return ([function (this: unknown) { return Array.isArray(this); }][0]! || 0)(); },
  asOnTheRead: function () { return (([function (this: unknown) { return Array.isArray(this); }][0] as any) || 0)(); },
  aroundAnOperatorOnTheRight: function () { return ((0 || [function (this: unknown) { return Array.isArray(this); }][0]) as any)(); },
};
for (const [name, f] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + f(holder) + " | " + again(holder));
}
