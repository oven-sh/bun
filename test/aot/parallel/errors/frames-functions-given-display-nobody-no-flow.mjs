// Prints what the first stack frame calls function objects of one function, one of which has been given a displayName through a value that came back out of code made at run time: for each way to call them.
// Flags: --aot-disable=flow-results
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const callIt = new Function("f", "return f();" + never);
function make() {
  return function made(during) {
    if (during) during();
    return new Error("x").stack;
  };
}
function makeArrow() {
  let made;
  made = () => new Error("x").stack;
  return made;
}
function makeConstructor() {
  return function Made() {
    this.stack = new Error("x").stack;
  };
}
function makeGetter() {
  return Object.getOwnPropertyDescriptor(
    {
      get made() {
        return new Error("x").stack;
      },
    },
    "made",
  ).get;
}
function makeTail() {
  return function made(next) {
    return next ? next() : new Error("x").stack;
  };
}
{
  const list = [make(), make(), make()];
  handedBack(list[1]).displayName = "displayed";
  console.log("one call in a callback |", list.map(f => firstFrame(f())).join(" | "));
  const frames = [];
  for (const f of list) frames.push(firstFrame(f()));
  for (const f of list.reverse()) frames.push(firstFrame(f()));
  console.log("one call in a loop, both ways |", frames.join(" | "));
}
{
  const a = makeArrow();
  const b = makeArrow();
  handedBack(a).displayName = "displayed";
  console.log("calls in a row |", firstFrame(a()), "|", firstFrame(b()), "|", firstFrame(a()));
  console.log(
    "by code made at run time |",
    firstFrame(callIt(a)),
    "|",
    firstFrame(callIt(b)),
    "|",
    firstFrame(callIt(a)),
  );
  console.log("by map |", [1].map(a).map(firstFrame)[0], "|", [1].map(b).map(firstFrame)[0]);
  console.log(
    "by then |",
    firstFrame(await Promise.resolve().then(a)),
    "|",
    firstFrame(await Promise.resolve().then(b)),
  );
  console.log(
    "by call, apply, Reflect.apply |",
    firstFrame(a.call(null)),
    "|",
    firstFrame(b.apply(null, [])),
    "|",
    firstFrame(Reflect.apply(a, null, [])),
  );
}
{
  const A = makeConstructor();
  const B = makeConstructor();
  handedBack(A).displayName = "Displayed";
  console.log("by new |", firstFrame(new A().stack), "|", firstFrame(new B().stack), "|", firstFrame(new A().stack));
  console.log(
    "by Reflect.construct |",
    firstFrame(Reflect.construct(A, []).stack),
    "|",
    firstFrame(Reflect.construct(B, []).stack),
  );
}
{
  const g = makeGetter();
  const h = makeGetter();
  handedBack(g).displayName = "displayed";
  const o = Object.defineProperty({}, "x", { get: g });
  const p = Object.defineProperty({}, "x", { get: h });
  console.log(
    "by a read |",
    firstFrame(o.x),
    "|",
    firstFrame(p.x),
    "|",
    firstFrame(handedBack(o).x),
    "|",
    firstFrame(handedBack(p).x),
  );
}
{
  const a = make();
  const b = make();
  handedBack(a).displayName = "first";
  handedBack(b).displayName = "second";
  console.log("both given one |", firstFrame(a()), "|", firstFrame(b()));
  delete handedBack(a).displayName;
  console.log("one deleted |", firstFrame(a()), "|", firstFrame(b()));
}
{
  const a = makeTail();
  const b = makeTail();
  handedBack(a).displayName = "displayed";
  console.log(
    "by a tail call |",
    firstFrame(a(b)),
    "|",
    firstFrame(b(a)),
    "|",
    firstFrame(handedBack(a)(b)),
    "|",
    firstFrame(handedBack(b)(a)),
  );
}
{
  const a = make();
  const b = make();
  const give = () => void (handedBack(a).displayName = "displayed");
  console.log(
    "given while it runs |",
    firstFrame(handedBack(a)(give)),
    "|",
    firstFrame(handedBack(b)()),
    "|",
    firstFrame(handedBack(a)()),
  );
}
