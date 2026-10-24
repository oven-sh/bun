// The caller reads fields of an object, calls a method of that object, and reads the fields again. The method is known, so the call is direct. In some rounds it damages `this`.
let mode = 0;
class Tank {
  level: number;
  limit: number;
  constructor(level: number, limit: number) {
    this.level = level;
    this.limit = limit;
  }
  fill(by: number): number {
    this.level += by;
    if (mode === 1) delete (this as any).limit;
    else if (mode === 2) (this as any).level = "full";
    else if (mode === 3) Object.freeze(this);
    return this.level;
  }
}

function holder(tank: Tank): string {
  const before = tank.level + "/" + tank.limit;
  const got = tank.fill(1);
  const read = tank.level + "/" + tank.limit;
  let again: string;
  try {
    again = "" + tank.fill(1);
  } catch (error) {
    again = (error as Error).name;
  }
  return before + " " + got + " " + read + " " + again + " " + tank.level + "/" + tank.limit;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Tank(round, 1000));
  if (mode || round === 0) console.log(round + ": " + line);
}
