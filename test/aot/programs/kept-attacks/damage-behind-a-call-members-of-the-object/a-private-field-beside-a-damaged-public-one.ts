// An object has private fields, which nobody outside the class can delete or redefine, beside public ones. A call damages the public ones, freezes the object, or changes its prototype. The methods go on reading and storing the private ones.
let mode = 0;
function touch(o: object): void {
  if (mode === 1) delete (o as any).open;
  else if (mode === 2) Object.freeze(o);
  else if (mode === 3) Object.setPrototypeOf(o, null);
}

class Safe {
  #secret: number;
  open: number;
  constructor(secret: number, open: number) {
    this.#secret = secret;
    this.open = open;
  }
  static turn(safe: Safe): string {
    const before = safe.#secret + "," + safe.open;
    touch(safe);
    safe.#secret += 1;
    return before + " " + safe.#secret + "," + safe.open + " " + (#secret in safe);
  }
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = Safe.turn(new Safe(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}
