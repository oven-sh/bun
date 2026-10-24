// Object.assign stores into fields without the compiled store: a string into a number field, a number into a boolean field, a property that the class does not declare. It runs below a call, and the caller has read the object.
class Lamp {
  on: boolean;
  watts: number;
  constructor(on: boolean, watts: number) {
    this.on = on;
    this.watts = watts;
  }
}

let mode = 0;
function below(lamp: Lamp): number {
  if (mode === 1) Object.assign(lamp, { watts: "many" });
  else if (mode === 2) Object.assign(lamp, { on: 1 });
  else if (mode === 3) Object.assign(lamp, { color: "red" });
  else if (mode === 4) Object.assign(lamp, { watts: 60, on: false });
  else if (mode === 5) Object.assign(lamp, JSON.parse('{"watts":null,"on":"off"}'));
  return 1;
}

function holder(lamp: Lamp): string {
  const before = (lamp.on ? "lit" : "dark") + lamp.watts;
  const got = below(lamp);
  return before + " " + got + " " + (lamp.on ? "lit" : "dark") + "," + (lamp.on === true) + "," + (lamp.watts + 1) + "," + Object.keys(lamp).length;
}

for (let round = 0; round < 600; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Lamp(true, round));
  if (mode || round === 0) console.log(round + ": " + line);
}
