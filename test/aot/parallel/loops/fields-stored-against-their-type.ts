// A loop stores undefined or null into a field whose written type has neither, and reads the field again.
const never: any = JSON.parse("0");
const enum Tint {
  None = 0,
  Red = 1,
  Gold = 4,
}

class Crate {
  tint: Tint;
  constructor(seed: number) {
    if (never) eval("");
    this.tint = seed as Tint;
  }
}
function tints(turns: number): string {
  let holes = 0;
  let sum = 0;
  const crate = new Crate(4);
  for (let k = 0; k < turns; k++) {
    const seen: unknown = crate.tint;
    if (seen === undefined) holes++;
    else sum += seen as number;
    crate.tint = (k & 1 ? Tint.Gold : undefined) as Tint;
  }
  return holes + " " + sum;
}
console.log(tints(1), tints(4), tints(300));

class Hidden {
  #tint: Tint;
  constructor(seed: number) {
    if (never) eval("");
    this.#tint = seed as Tint;
  }
  static tints(turns: number): string {
    let holes = 0;
    let sum = 0;
    const hidden = new Hidden(1);
    for (let k = 0; k < turns; k++) {
      const seen: unknown = hidden.#tint;
      if (seen === undefined) holes++;
      else sum += seen as number;
      hidden.#tint = (k & 1 ? Tint.Red : never.missing) as Tint;
    }
    return holes + " " + sum;
  }
}
console.log(Hidden.tints(1), Hidden.tints(4), Hidden.tints(300));

class Label {
  text: string;
  parts: { count: number };
  constructor(seed: number) {
    if (never) eval("");
    this.text = "t" + seed;
    this.parts = { count: seed };
  }
}
function labels(turns: number): string {
  let length = 0;
  let count = 0;
  const label = new Label(4);
  for (let k = 0; k < turns; k++) {
    length += (label.text as string | undefined)?.length ?? 100;
    label.text = (k % 3 ? "long" + k : undefined) as string;
  }
  for (let k = 0; k < turns; k++) {
    count += (label.parts as { count: number } | null)?.count ?? 1000;
    label.parts = (k & 1 ? { count: k } : null)!;
  }
  return length + " " + count;
}
console.log(labels(1), labels(4), labels(300));

// What every store fits stays as it is.
function golds(turns: number): string {
  let sum = 0;
  const crate = new Crate(4);
  for (let k = 0; k < turns; k++) {
    sum += crate.tint;
    crate.tint = k & 1 ? Tint.Gold : Tint.Red;
  }
  return String(sum);
}
console.log(golds(1), golds(4), golds(300));
