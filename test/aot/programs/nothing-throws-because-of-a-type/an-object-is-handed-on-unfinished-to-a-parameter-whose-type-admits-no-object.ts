// A field initializer hands `this` on before the fields behind it are defined, to a parameter whose type admits no object. Whoever gets it sees the object as it is at that moment.
function describe(given: any): string {
  return (
    Object.keys(given).join() +
    "|" +
    ("late" in given) +
    "|" +
    Object.hasOwn(given, "late") +
    "|" +
    given.late +
    "|" +
    JSON.stringify(given)
  );
}
function takesText(seen: string): string {
  return describe(seen);
}
function takesNumber(seen: number): string {
  const given: any = seen;
  return ("late" in given) + "|" + given.late;
}
function takesOneOfThree(seen: "k0" | "k1" | "k2"): string {
  return describe(seen);
}
class Other {
  x = 1;
}
function takesOther(seen: Other): string {
  return describe(seen);
}
class SeenAsText {
  first = 1;
  early: string = takesText(this as any);
  late = 3;
}
class SeenAsNumber {
  first = 1;
  early: string = takesNumber(this as any);
  late = 3;
}
class SeenAsOneOfThree {
  first = 1;
  early: string = takesOneOfThree(this as any);
  middle = "m";
  again: string = takesOneOfThree(this as any);
  late = 3;
}
class SeenAsOther {
  first = 1;
  early: string = takesOther(this as any);
  late = 3;
}
class Heir extends SeenAsNumber {}
for (let turn = 0; turn < 3; turn++) {
  console.log(new SeenAsText().early, takesText(new SeenAsText() as any));
  console.log(new SeenAsNumber().early, new Heir().early, takesNumber(new SeenAsNumber() as any));
  console.log(JSON.stringify(new SeenAsOneOfThree()));
  console.log(new SeenAsOther().early, takesOther(new Other()));
}
