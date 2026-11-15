function say(name: string, f: () => unknown) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, String(error));
  }
}
const unknownKey: string = JSON.parse('"x"');
const unknown: number = JSON.parse("1");
let seen: unknown, again: unknown;
class Gauge {
  level: any = undefined;
  set mark(value: any) {
    const held = new Map([[1, value]]).get(1);
    (() => (seen = again = unknown ? held : 0))();
  }
}
function empty(gauge: Gauge) {
  delete (gauge as any)[unknownKey];
  return Object.keys(gauge).length;
}
say("empty", () => empty(new Gauge()));
say("set", () => {
  const gauge = new Gauge();
  gauge.mark = undefined;
  return seen;
});
