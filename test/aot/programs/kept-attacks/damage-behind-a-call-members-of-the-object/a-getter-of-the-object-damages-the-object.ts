// A getter and a setter of the class of the object are known, so reading and storing the property are direct calls. In some rounds they damage the object that they are called on.
let mode = 0;
class Reading {
  raw: number;
  scale: number;
  constructor(raw: number, scale: number) {
    this.raw = raw;
    this.scale = scale;
  }
  get value(): number {
    if (mode === 1) delete (this as any).scale;
    return this.raw * 2;
  }
  set value(next: number) {
    if (mode === 2) (this as any).raw = "raw";
    else this.raw = next;
  }
}

function holder(reading: Reading): string {
  const before = reading.raw + "*" + reading.scale;
  const got = reading.value;
  const first = reading.raw + "*" + reading.scale;
  reading.value = 5;
  return before + " " + got + " " + first + " " + reading.raw + "*" + reading.scale + " " + reading.value;
}

for (let round = 0; round < 300; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Reading(round, 3));
  if (mode || round === 0) console.log(round + ": " + line);
}
