// In `tank.fill(touch(tank))` the receiver is evaluated first and the argument damages it. The method then runs on the damaged object, entered from a caller that has read the object before.
let mode = 0;
class Tank {
  level: number;
  limit: number;
  constructor(level: number, limit: number) {
    this.level = level;
    this.limit = limit;
  }
  fill(by: number): string {
    return this.level + by + "/" + this.limit;
  }
}
function touch(tank: Tank): number {
  if (mode === 1) delete (tank as any).level;
  else if (mode === 2) (tank as any).limit = "none";
  else if (mode === 3) Object.defineProperty(tank, "level", { get: () => -7 });
  return 1;
}

function holder(tank: Tank): string {
  const before = tank.level + tank.limit;
  return before + " " + tank.fill(touch(tank)) + " " + tank.fill(0);
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Tank(round, 1000));
  if (mode || round === 0) console.log(round + ": " + line);
}
