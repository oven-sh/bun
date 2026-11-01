// Flags: --aot-validate
// A list that the caller keeps in its frame is handed to a function that only looks at it: in a switch over numbers, a switch over texts, a branch.
const print = console.log;
function byNumber(x: any) {
  switch (x) {
    case 3: return "three";
    case 5: return "five";
  }
  return "other";
}
function byText(x: any) {
  switch (x) {
    case "a": return "first";
    case "b": return "second";
  }
  return "other";
}
function byTruth(x: any) {
  if (x) return "yes";
  return "no";
}
class Holder {
  look(x: any) {
    switch (x) {
      case 1: return "one";
      case 2: return "two";
    }
    return "other";
  }
  field = (x: any) => {
    switch (x) {
      case 1: return "one";
    }
    return "other";
  };
}
{
  const holder = new Holder();
  print(byNumber({ valueOf() { return 1; } } as any), byNumber(1), byNumber([2] as any), byNumber(5));
  print(byText(["a"] as any), byText("b"), byText({ toString() { return "a"; } } as any));
  print(byTruth([] as any), byTruth([0] as any), byTruth(0));
  print(holder.look([1] as any), holder.look(2), holder.field([1] as any), holder.field(1));
}
