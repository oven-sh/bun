// Each line: the name in the first frame of a closure that was entered before a closure of the same function got a displayName. The stored output lists the closure that runs under the new name until it returns.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
{
  function make() {
    return function made(during) {
      during();
      return new Error("x").stack;
    };
  }
  const list = [make(), make()];
  console.log(
    "the other one is renamed while this one runs |",
    firstFrame(
      handedBack(list[1])(() => {
        handedBack(list[0]).displayName = "displayed";
      }),
    ),
    "|",
    firstFrame(handedBack(list[0])(() => {})),
    "|",
    firstFrame(handedBack(list[1])(() => {})),
  );
}
{
  function make() {
    return function made(during) {
      during();
      return new Error("x").stack;
    };
  }
  const list = [make(), make()];
  console.log(
    "this one is renamed while it runs |",
    firstFrame(
      handedBack(list[0])(() => {
        handedBack(list[0]).displayName = "displayed";
      }),
    ),
    "|",
    firstFrame(handedBack(list[0])(() => {})),
    "|",
    firstFrame(handedBack(list[1])(() => {})),
  );
}
/* Output:
the other one is renamed while this one runs | at displayed | at displayed | at made
this one is renamed while it runs | at displayed | at displayed | at made
*/
