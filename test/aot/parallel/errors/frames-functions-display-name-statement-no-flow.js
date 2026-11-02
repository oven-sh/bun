// Prints what the first stack frame calls a function that has a displayName, before and after a statement looks for the property `name` of the function object and does nothing with the answer.
// Flags: --aot-disable=flow-results
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
function show(label, f, before) {
  console.log(`${label} | ${before} | ${firstFrame(f())}`);
}
function unusedRead() {
  return new Error("x").stack;
}
unusedRead.displayName = "displayed";
{
  const before = firstFrame(unusedRead());
  void unusedRead.name;
  show("a read that nobody uses", unusedRead, before);
}
function unusedReadUnderKey() {
  return new Error("x").stack;
}
unusedReadUnderKey.displayName = "displayed";
{
  const before = firstFrame(unusedReadUnderKey());
  unusedReadUnderKey["name"];
  show("a read in brackets that nobody uses", unusedReadUnderKey, before);
}
function unusedIn() {
  return new Error("x").stack;
}
unusedIn.displayName = "displayed";
{
  const before = firstFrame(unusedIn());
  "name" in unusedIn;
  show("in", unusedIn, before);
}
function unusedHasOwnProperty() {
  return new Error("x").stack;
}
unusedHasOwnProperty.displayName = "displayed";
{
  const before = firstFrame(unusedHasOwnProperty());
  unusedHasOwnProperty.hasOwnProperty("name");
  show("hasOwnProperty", unusedHasOwnProperty, before);
}
function unusedHasOwn() {
  return new Error("x").stack;
}
unusedHasOwn.displayName = "displayed";
{
  const before = firstFrame(unusedHasOwn());
  Object.hasOwn(unusedHasOwn, "name");
  show("Object.hasOwn", unusedHasOwn, before);
}
function unusedKeys() {
  return new Error("x").stack;
}
unusedKeys.displayName = "displayed";
{
  const before = firstFrame(unusedKeys());
  Object.keys(unusedKeys);
  show("Object.keys", unusedKeys, before);
}
function unusedNames() {
  return new Error("x").stack;
}
unusedNames.displayName = "displayed";
{
  const before = firstFrame(unusedNames());
  Object.getOwnPropertyNames(unusedNames);
  show("Object.getOwnPropertyNames", unusedNames, before);
}
function unusedDescriptor() {
  return new Error("x").stack;
}
unusedDescriptor.displayName = "displayed";
{
  const before = firstFrame(unusedDescriptor());
  Object.getOwnPropertyDescriptor(unusedDescriptor, "name");
  show("Object.getOwnPropertyDescriptor", unusedDescriptor, before);
}
function unusedPattern() {
  return new Error("x").stack;
}
unusedPattern.displayName = "displayed";
{
  const before = firstFrame(unusedPattern());
  const { name } = unusedPattern;
  show("a pattern", unusedPattern, before);
}
function unusedSpread() {
  return new Error("x").stack;
}
unusedSpread.displayName = "displayed";
{
  const before = firstFrame(unusedSpread());
  ({ ...unusedSpread });
  show("a spread", unusedSpread, before);
}
function unusedForIn() {
  return new Error("x").stack;
}
unusedForIn.displayName = "displayed";
{
  const before = firstFrame(unusedForIn());
  for (const key in unusedForIn);
  show("for in", unusedForIn, before);
}
function otherRead() {
  return new Error("x").stack;
}
otherRead.displayName = "displayed";
{
  const before = firstFrame(otherRead());
  void otherRead.length;
  show("a read of length", otherRead, before);
}
function readFirst() {
  return new Error("x").stack;
}
console.log(readFirst.name);
readFirst.displayName = "displayed";
show("a displayName given after the read", readFirst, "");
const arrow = () => new Error("x").stack;
arrow.displayName = "displayed";
{
  const before = firstFrame(arrow());
  void arrow.name;
  show("an arrow function", arrow, before);
}
const getter = Object.getOwnPropertyDescriptor(
  {
    get g() {
      return new Error("x").stack;
    },
  },
  "g",
).get;
{
  const before = firstFrame(getter());
  void getter.name;
  show("a getter", getter, before);
}
const setterHolder = {
  stack: "",
  set s(value) {
    setterHolder.stack = new Error("x").stack;
  },
};
const setter = Object.getOwnPropertyDescriptor(setterHolder, "s").set;
{
  setter(1);
  const before = firstFrame(setterHolder.stack);
  void setter.name;
  setter(1);
  console.log(`a setter | ${before} | ${firstFrame(setterHolder.stack)}`);
}
function make() {
  function made() {
    return new Error("x").stack;
  }
  made.displayName = "displayed";
  return made;
}
const first = make();
const second = make();
void first.name;
console.log(`one of two function objects of one place | ${firstFrame(first())} | ${firstFrame(second())}`);
const nameOf = f => f.name;
function neverDisplayed() {}
console.log(
  nameOf(neverDisplayed),
  nameOf(neverDisplayed),
  nameOf(() => {}),
);
function readByAnother() {
  return new Error("x").stack;
}
console.log(nameOf(readByAnother));
readByAnother.displayName = "displayed";
show("a displayName given after a function read the name", readByAnother, "");
function readByAnotherLater() {
  return new Error("x").stack;
}
readByAnotherLater.displayName = "displayed";
{
  const before = firstFrame(readByAnotherLater());
  nameOf(readByAnotherLater);
  show("a function reads the name", readByAnotherLater, before);
}
class Shown {
  static displayName = "displayed";
  constructor() {
    this.stack = new Error("x").stack;
  }
}
{
  const before = firstFrame(new Shown().stack);
  void Shown.name;
  console.log(`a class | ${before} | ${firstFrame(new Shown().stack)}`);
}
function definedAgain() {
  return new Error("x").stack;
}
definedAgain.displayName = "displayed";
{
  const before = firstFrame(definedAgain());
  Object.defineProperty(definedAgain, "name", { value: "definedAgain" });
  show("defined with the text it had", definedAgain, before);
}
function removed() {
  return new Error("x").stack;
}
removed.displayName = "displayed";
{
  const before = firstFrame(removed());
  delete removed.name;
  show("deleted", removed, before);
}
{
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) =>
    sites
      .slice(0, 2)
      .map(site => site.getFunctionName())
      .join(" < ");
  console.log(`call sites | ${first()} | ${second()}`);
  Error.prepareStackTrace = prepare;
}
