// @ts-nocheck
// Older: a later declaration of an enum names a member of an earlier one by its bare name. `bun run` and `bun build` have the value in place, so the member behind counts on: D is 103.
// An executable built with --aot computed C at run time and left D without a value.
const show = (label: string, seen: any) =>
  console.log(
    label,
    Object.keys(seen)
      .map(key => key + "=" + String(seen[key]))
      .join(" "),
  );
enum Top {
  A = 100,
  B,
}
enum Top {
  C = B + 1,
  D,
  F = A,
}
namespace Held {
  export enum E {
    A = 100,
    B,
  }
  export enum E {
    C = B + 1,
    D,
    F = E.A,
  }
}
show("Top", Top);
show("Held.E", Held.E);
console.log(Top.D, Held.E.D, Top[103]);
export {};
