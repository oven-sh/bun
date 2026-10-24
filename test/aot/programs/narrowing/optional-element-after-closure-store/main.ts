// A nested function assigns the variable. TypeScript still narrows it to the `undefined` or `null` that was stored first, so it types `a?.[0]` as `undefined`.
// The element that is read is whatever the array holds.
function later(f: () => void) {
  f();
}
function tell(name: string, make: () => unknown) {
  try {
    console.log(name + ": " + JSON.stringify(make()));
  } catch (e) {
    console.log(name + ": " + (e as Error).name + ": " + (e as Error).message.split("\n")[0]);
  }
}
tell("returned", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return a?.[0];
});
tell("in an array literal", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return [a?.[0]];
});
tell("in an object literal", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return { first: a?.[0] };
});
tell("as an argument", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return String(a?.[0]);
});
tell("by a name in brackets", () => {
  let o: { open: boolean } | null = null;
  later(() => {
    o = { open: true };
  });
  // @ts-ignore
  return [o?.["open"]];
});
tell("beside a call and a member", () => {
  let f: (() => string) | undefined = undefined,
    a: number[] | undefined = undefined,
    o: { m: string } | undefined = undefined;
  later(() => {
    f = () => "f";
    a = [7];
    o = { m: "m" };
  });
  // @ts-ignore
  return [f?.(), a?.[0], o?.m];
});
tell("further down the chain", () => {
  let a: { n: number }[] | undefined = undefined;
  later(() => {
    a = [{ n: 7 }];
  });
  // @ts-ignore
  return [a?.[0].n, a?.[0]?.n];
});
tell("never assigned", () => {
  let a: number[] | undefined = undefined;
  later(() => {});
  // @ts-ignore
  return [a?.[0]];
});
