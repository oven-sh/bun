// The loop reads an optional field, then an accessor of another name that the class has from the start, then the field again.
// In one round the accessor, a conversion by valueOf or a conversion by toString puts the field's name on the prototype: the read right behind it must see that.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
let armed = "";
function arrive(holder: object, name: string, value: number) {
  Object.defineProperty(holder, name, { value, writable: true, enumerable: false, configurable: true });
}
class Gauge {
  declare id: number;
  peak?: number;
  constructor(id: number) {
    delete this.peak;
    handOver(this);
    this.id = id;
  }
  get level() {
    if (armed === "accessor") {
      armed = "";
      arrive(Gauge.prototype, "pe" + "ak", 1000);
    }
    return 1;
  }
  valueOf() {
    if (armed === "valueOf") {
      armed = "";
      arrive(Gauge.prototype, "pe" + "ak", 2000);
    }
    return 1;
  }
  toString() {
    if (armed === "toString") {
      armed = "";
      arrive(Gauge.prototype, "pe" + "ak", 3000);
    }
    return "g";
  }
}
function throughTheAccessor(gauges: Gauge[], at: number) {
  let sum = 0;
  for (let i = 0; i < gauges.length; i++) {
    const gauge = gauges[i];
    if (i === at) armed = "accessor";
    sum += gauge.peak ?? 0;
    sum += gauge.level;
    sum += gauge.peak ?? 0;
  }
  return sum;
}
function throughValueOf(gauges: Gauge[], at: number) {
  let sum = 0;
  for (let i = 0; i < gauges.length; i++) {
    const gauge = gauges[i];
    if (i === at) armed = "valueOf";
    sum += (gauge.peak ?? 0) + +gauge + (gauge.peak ?? 0);
  }
  return sum;
}
function throughToString(gauges: Gauge[], at: number) {
  let sum = 0;
  for (let i = 0; i < gauges.length; i++) {
    const gauge = gauges[i];
    if (i === at) armed = "toString";
    sum += `${gauge.peak ?? ""}${gauge}${gauge.peak ?? ""}`.length;
  }
  return sum;
}

const gauges: Gauge[] = [];
for (let i = 0; i < 3000; i++) gauges.push(new Gauge(i));
gauges[5].peak = 10;
for (const run of [throughTheAccessor, throughValueOf, throughToString]) {
  console.log(run.name, "without a change:", run(gauges, -1));
  console.log(run.name, "with a change in round 2998:", run(gauges, 2998));
  console.log(run.name, "afterwards:", run(gauges, -1), gauges[0].peak, gauges[5].peak, new Gauge(0).peak);
  delete (Gauge.prototype as any).peak;
  console.log(run.name, "gone again:", run(gauges, -1), gauges[0].peak);
}
