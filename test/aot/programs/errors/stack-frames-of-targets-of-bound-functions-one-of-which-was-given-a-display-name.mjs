// Prints what the first stack frame calls the target of a bound function: two function objects of one function, one of which has been given a displayName through a value that came back out of code made at run time.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function makeArrow() {
  let made;
  made = () => new Error("x").stack;
  return made;
}
function make() {
  return function made(x, y) {
    return new Error("x").stack;
  };
}
{
  const a = makeArrow(),
    b = makeArrow();
  handedBack(a).displayName = "displayed";
  console.log(
    "bound |",
    firstFrame(a.bind(null)()),
    "|",
    firstFrame(b.bind(null)()),
    "|",
    firstFrame(handedBack(a.bind(null))()),
    "|",
    firstFrame(handedBack(a).bind(null)()),
    "|",
    firstFrame(a()),
  );
}
{
  const a = make(),
    b = make();
  const early = a.bind(null),
    earlyOfOther = b.bind(null, 1);
  handedBack(a).displayName = "displayed";
  console.log(
    "bound before |",
    firstFrame(early()),
    "|",
    firstFrame(earlyOfOther()),
    "|",
    firstFrame(handedBack(early)()),
    "|",
    firstFrame(early.bind(null, 1, 2)()),
  );
  const bound = handedBack(a).bind(null, 1);
  console.log(
    "what the bound function has |",
    bound.name,
    "|",
    bound.length,
    "|",
    firstFrame(bound()),
    "|",
    firstFrame(a()),
  );
  console.log("once the name was read |", a.name, "|", firstFrame(a.bind(null)()), "|", firstFrame(a()));
}
{
  const a = make(),
    b = make();
  handedBack(a).displayName = "displayed";
  Object.defineProperty(handedBack(a), "length", { value: 7 });
  const bound = handedBack(a).bind(null, 1);
  console.log(
    "another length |",
    bound.name,
    "|",
    bound.length,
    "|",
    firstFrame(bound()),
    "|",
    firstFrame(a()),
    "|",
    firstFrame(b()),
  );
}
{
  const a = make(),
    b = make();
  handedBack(a).displayName = "displayed";
  Object.defineProperty(handedBack(a), "name", { value: "named" });
  const bound = handedBack(a).bind(null, 1);
  console.log(
    "another name |",
    bound.name,
    "|",
    bound.length,
    "|",
    firstFrame(bound()),
    "|",
    firstFrame(a()),
    "|",
    firstFrame(b()),
  );
}
{
  const a = make(),
    b = make();
  handedBack(a).displayName = "displayed";
  delete handedBack(a).name;
  const bound = handedBack(a).bind(null, 1);
  console.log(
    "no name |",
    JSON.stringify(bound.name),
    "|",
    bound.length,
    "|",
    firstFrame(bound()),
    "|",
    firstFrame(a()),
    "|",
    firstFrame(b()),
  );
}
{
  const a = make(),
    b = make();
  handedBack(a).displayName = "displayed";
  delete handedBack(a).length;
  const bound = handedBack(a).bind(null, 1);
  console.log(
    "no length |",
    bound.name,
    "|",
    bound.length,
    "|",
    firstFrame(bound()),
    "|",
    firstFrame(a()),
    "|",
    firstFrame(b()),
  );
}
