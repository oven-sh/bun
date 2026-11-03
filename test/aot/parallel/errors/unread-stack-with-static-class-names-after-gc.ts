// A GC formats the stack of an error early when a function in its frames has died. Each stack here has the frame of a class that is named by a static field.
type Kind = "first" | "second";
type Make = () => void;

const errors: Error[] = [];
function keep(): void {
  errors.push(new Error("kept"));
}

class LiteralDisplayName {
  static displayName: Kind = "first";
  constructor(make: Make) { make(); }
}
class StringDisplayName {
  static displayName = "a display name";
  constructor(make: Make) { make(); }
}
class EmptyDisplayName {
  static displayName = "";
  constructor(make: Make) { make(); }
}
class NumberDisplayName {
  static displayName = 1;
  constructor(make: Make) { make(); }
}
class StringName {
  static name = "a static name";
  constructor(make: Make) { make(); }
}
class LiteralName {
  static name: Kind = "second";
  constructor(make: Make) { make(); }
}
class BothNames {
  static name: Kind = "first";
  static displayName: Kind = "second";
  constructor(make: Make) { make(); }
}
class StaticMethod {
  static displayName: Kind = "second";
  static run(make: Make): void { make(); }
  constructor(make: Make) { StaticMethod.run(make); }
}
const Anonymous = [class { static displayName: Kind = "second"; constructor(make: Make) { make(); } }][0];

for (const constructor of [LiteralDisplayName, StringDisplayName, EmptyDisplayName, NumberDisplayName, StringName, LiteralName, BothNames, StaticMethod, Anonymous]) {
  // Each class has a caller of its own, whose source is not known at build time. Nothing holds it after the call.
  new Function("constructor", "make", "return [new constructor(make)]; // " + Date.now())(constructor, keep);
}

Bun.gc(true);

for (const error of errors) {
  const frames = error.stack!.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""));
  console.log(frames.filter(frame => !/[\\/]/.test(frame)).join(" < "));
}
