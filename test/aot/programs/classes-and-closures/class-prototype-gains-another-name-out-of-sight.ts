async function attempt(name: string, run: () => unknown): Promise<void> {
  try {
    console.log(name + ":", await run());
  } catch (error) {
    console.log(name + ": throws", (error as Error).name);
  }
}
function prototypeOf(value: any): any {
  return Object.getPrototypeOf(value);
}

class Noted { n = 1; declare other?: string; }
(Noted.prototype as any).extra = 1;
await attempt("an optional field that is absent, by another name than the one seen", () => {
  const noted = new Noted();
  const before = noted.other;
  prototypeOf(noted).other = "late";
  return [before, noted.other, (noted as any).other, "other" in noted].join(" ");
});

class Asked { n = 1; }
(Asked.prototype as any).extra = 1;
await attempt("in and a read through any, by another name", () => {
  const asked = new Asked();
  const before = ["late" in asked, (asked as any).late].join();
  prototypeOf(asked).late = 7;
  return [before, "late" in asked, (asked as any).late].join(" ");
});

class Above { who(): string { return "Above"; } }
class Below extends Above { k = 2; }
(Below.prototype as any).extra = 1;
await attempt("a method of the base class hidden by another name than the one seen", () => {
  const below = new Below();
  const before = below.who();
  prototypeOf(below).who = () => "late";
  return [before, below.who(), new Above().who()].join(" ");
});

class Awaited { n = 1; }
(Awaited.prototype as any).extra = 1;
await attempt("then, where only another name is seen", async () => {
  const awaited = new Awaited();
  const before = (await awaited) === awaited;
  prototypeOf(awaited).then = function (resolve: (value: string) => void) { resolve("thenable"); };
  return [before, await awaited].join(" ");
});

class Base { b = 1; }
class Heir extends Base { h = 2; declare other?: string; }
(Base.prototype as any).extra = 1;
await attempt("an heir of the class that is seen, by another name on the base", () => {
  const heir = new Heir();
  const before = heir.other;
  prototypeOf(prototypeOf(heir)).other = "late";
  return [before, heir.other].join(" ");
});
