// Prints where a stack trace places what stands beside a member of an enum whose value is known when the file is parsed.
enum Level {
  Low,
  High = 4,
  Name = "name",
}
const enum Fixed {
  One = 1,
}
function fail(...values: unknown[]): never {
  throw new Error("fail");
}
function pass<T>(value: T): T {
  return value;
}
const nothing: any = null;
const inThisFile = /stack-positions-beside-members-of-enums/;
function placesOf(error: any): string[] {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)![1]);
}
function show(label: string, run: () => unknown) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error: any) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("a", () => { (function () { fail(); return Level.High; })(); });
show("b", () => { (function () { fail(); return Level["Low"]; })(); });
show("c", () => { (function () { fail(); return Level.Name; })(); });
show("d", () => { (function () { fail(); return Fixed.One; })(); });
show("e", () => { (function () { fail(); pass(Level.High); })(); });
show("h", () => { (function () { fail(); return [Level.High]; })(); });
show("i", () => { (() => { fail(); return Level[4]; })(); });
show("j", () => { const once = pass(nothing); fail(Level.High, once.x); });
show("k", () => { const once = fail; pass(Level.High); once(); });
show("l", () => { const once = nothing; pass(Level.High + once.x); });
show("m", () => { nothing[Level.High].x; });
show("n", () => { nothing[Level.Name](); });
show("o", () => { (Level.High as any)(); });
show("p", () => { (Level.High as any).x.y; });
show("q", () => { (Level.Name as any).x.y; });
show("r", () => { (Level.Name.length.toString() as any).x.y; });
show("s", () => { (pass(Level.High) as any)(); });
show("t", () => { new (Level.High as any)(); });
show("u", () => { Level.High in nothing; });
show("v", () => { nothing instanceof (Level.High as any); });
show("w", () => { `${Level.High}${Symbol() as any}`; });
show("x", () => { Level.High + (Symbol() as any); });
show("y", () => { (Symbol() as any) + Level.High; });
show("z", () => { const { x } = nothing[Level.High]; });
