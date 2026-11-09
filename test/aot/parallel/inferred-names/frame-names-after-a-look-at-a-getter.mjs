// What a stack frame calls a getter after something has looked at one of its function objects: that one, another made before, and one made later.
const first = stack =>
  String(stack)
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
let sink;
const make0 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make0(0);
  const other = make0(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Reflect.ownKeys(f);
  console.log(
    "Reflect.ownKeys",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make0(1).made),
  );
}
const make1 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make1(0);
  const other = make1(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.getOwnPropertyNames(f);
  console.log(
    "getOwnPropertyNames",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make1(1).made),
  );
}
const make2 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make2(0);
  const other = make2(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.keys(f);
  console.log("Object.keys", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make2(1).made));
}
const make3 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make3(0);
  const other = make3(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.getOwnPropertySymbols(f);
  console.log(
    "getOwnPropertySymbols",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make3(1).made),
  );
}
const make4 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make4(0);
  const other = make4(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.getOwnPropertyDescriptors(f);
  console.log(
    "getOwnPropertyDescriptors",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make4(1).made),
  );
}
const make5 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make5(0);
  const other = make5(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.entries(f);
  console.log(
    "Object.entries",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make5(1).made),
  );
}
const make6 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make6(0);
  const other = make6(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.values(f);
  console.log("Object.values", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make6(1).made));
}
const make7 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make7(0);
  const other = make7(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  for (const key in f) sink = key;
  console.log("for-in", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make7(1).made));
}
const make8 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make8(0);
  const other = make8(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  sink = { ...f };
  console.log("spread", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make8(1).made));
}
const make9 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make9(0);
  const other = make9(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.assign({}, f);
  console.log("Object.assign", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make9(1).made));
}
const make10 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make10(0);
  const other = make10(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  JSON.stringify(f);
  console.log(
    "JSON.stringify",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make10(1).made),
  );
}
const make11 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make11(0);
  const other = make11(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.isFrozen(f);
  console.log(
    "Object.isFrozen",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make11(1).made),
  );
}
const make12 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make12(0);
  const other = make12(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.isSealed(f);
  console.log(
    "Object.isSealed",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make12(1).made),
  );
}
const make13 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make13(0);
  const other = make13(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.freeze(f);
  console.log(
    "Object.freeze",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make13(1).made),
  );
}
const make14 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make14(0);
  const other = make14(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.seal(f);
  console.log("Object.seal", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make14(1).made));
}
const make15 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make15(0);
  const other = make15(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.preventExtensions(f);
  console.log(
    "preventExtensions",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make15(1).made),
  );
}
const make16 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make16(0);
  const other = make16(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.hasOwn(f, "name");
  console.log(
    "Object.hasOwn",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make16(1).made),
  );
}
const make17 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make17(0);
  const other = make17(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  f.hasOwnProperty("name");
  console.log(
    "hasOwnProperty",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make17(1).made),
  );
}
const make18 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make18(0);
  const other = make18(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  f.propertyIsEnumerable("name");
  console.log(
    "propertyIsEnumerable",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make18(1).made),
  );
}
const make19 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make19(0);
  const other = make19(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  sink = "name" in f;
  console.log("in", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make19(1).made));
}
const make20 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make20(0);
  const other = make20(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.getOwnPropertyDescriptor(f, "name");
  console.log(
    "getOwnPropertyDescriptor",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make20(1).made),
  );
}
const make21 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make21(0);
  const other = make21(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Reflect.getOwnPropertyDescriptor(f, "name");
  console.log(
    "Reflect.getOwnPropertyDescriptor",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make21(1).made),
  );
}
const make22 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make22(0);
  const other = make22(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Reflect.has(f, "name");
  console.log("Reflect.has", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make22(1).made));
}
const make23 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make23(0);
  const other = make23(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Reflect.get(f, "name");
  console.log("Reflect.get", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make23(1).made));
}
const make24 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make24(0);
  const other = make24(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  sink = f.name;
  console.log("read of name", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make24(1).made));
}
const make25 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make25(0);
  const other = make25(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  sink = f.length;
  console.log(
    "read of length",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make25(1).made),
  );
}
const make26 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make26(0);
  const other = make26(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  String(f);
  console.log("String", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make26(1).made));
}
const make27 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make27(0);
  const other = make27(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Bun.inspect(f);
  console.log("Bun.inspect", "|", before, "|", first(holder.made), "|", first(other.made), "|", first(make27(1).made));
}
const make28 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make28(0);
  const other = make28(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.fromEntries(Object.entries(f));
  console.log(
    "Object.fromEntries of entries",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make28(1).made),
  );
}
const make29 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make29(0);
  const other = make29(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  ({ ...sink } = f);
  console.log(
    "destructuring with rest",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make29(1).made),
  );
}
const make30 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make30(0);
  const other = make30(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  Object.groupBy(Object.getOwnPropertyNames(f), key => key);
  console.log(
    "Object.groupBy of names",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make30(1).made),
  );
}
const make31 = round => ({
  get made() {
    return new Error("x" + round).stack;
  },
});
{
  const holder = make31(0);
  const other = make31(0);
  const before = first(holder.made);
  const f = Object.getOwnPropertyDescriptor(holder, "made").get;
  delete f.name;
  console.log(
    "delete of name",
    "|",
    before,
    "|",
    first(holder.made),
    "|",
    first(other.made),
    "|",
    first(make31(1).made),
  );
}
