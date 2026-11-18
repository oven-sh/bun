// @ts-nocheck
// The other side: what `bun run` does not write in place stays out of the count here too: a constant of the enum's own block, one that stands behind the enum, a let, a parameter, a constant of another kind of value.
const show = (label: string, seen: any) =>
  console.log(
    label,
    Object.keys(seen)
      .map(key => key + "=" + String(seen[key]))
      .join(" "),
  );
const BASE = 100;
let soft = 7;
enum Beside {
  A = BASE,
  B,
}
namespace Own {
  const BASE = 8;
  export enum E {
    A = BASE,
    B,
  }
  export enum Soft {
    A = soft,
    B,
  }
}
function early() {
  enum E {
    A = LATER,
    B,
  }
  return E;
}
function given(BASE: number) {
  enum E {
    A = BASE,
    B,
  }
  return E;
}
try {
  show("early", early());
} catch (error) {
  console.log("early", error.name);
}
const LATER = 5;
show("Beside", Beside);
show("Own.E", Own.E);
show("Own.Soft", Own.Soft);
show("late", early());
show("given", given(3));
export {};
