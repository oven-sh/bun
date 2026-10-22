// In a loop of 6000 rounds the name is put on the prototype and deleted again every few rounds, in four forms: a value, a getter, a setter, a read-only value.
// Whatever was remembered about the last round is wrong in the next. A checksum over every read, test and store is printed for each stretch of 1000 rounds.
class Probe {
  declare id: number;
  declare v?: number;
  constructor(id: number) {
    this.id = id;
  }
}
let setterCalls = 0;
const forms: PropertyDescriptor[] = [
  { value: 3, writable: true, configurable: true },
  {
    get(this: Probe) {
      return this.id & 3;
    },
    configurable: true,
  },
  {
    set(this: Probe, value: number) {
      setterCalls += value;
    },
    configurable: true,
  },
  { value: 4, writable: false, configurable: true },
];
function read(probe: Probe) {
  return probe.v;
}
function has(probe: Probe) {
  return "v" in probe;
}
function write(probe: Probe, value: number) {
  try {
    probe.v = value;
    return 1;
  } catch {
    return 1000;
  }
}
const holder = Object.getPrototypeOf(new Probe(0));
const veteran = new Probe(1);
let sum = 0;
let present = false;
for (let i = 0; i < 6000; i++) {
  if (i % 7 === 3) {
    Object.defineProperty(holder, "v", forms[(i >> 3) & 3]);
    present = true;
  } else if (i % 7 === 6 || (present && i % 11 === 0)) {
    delete holder.v;
    present = false;
  }
  const probe = new Probe(i);
  sum += (read(probe) ?? 10) + (has(probe) ? 100 : 0) + (read(veteran) ?? 10);
  sum += write(probe, 5);
  sum += (read(probe) ?? 10) + (Object.hasOwn(probe, "v") ? 7 : 0);
  if (i % 13 === 0) sum += write(veteran, 6);
  if (i % 13 === 5) delete veteran.v;
  if (i % 1000 === 999) {
    console.log("rounds up to", i, "->", sum, setterCalls);
    sum = 0;
  }
}
delete holder.v;
console.log("at the end:", read(new Probe(2)), has(new Probe(3)), read(veteran), Object.keys(veteran).join());
