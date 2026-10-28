class Lamp {
  isOn = false;
  level = 0;
}

function step(lamp: Lamp, turn: number): string {
  lamp.isOn = turn % 2 === 1;
  lamp.level = turn & 7;
  return describe(lamp, 2);
}

function describe(lamp: Lamp, depth: number): string {
  if (depth > 0) return describe(lamp, depth - 1);
  return (lamp.isOn ? "on" : "off") + lamp.level;
}

const lamp = new Lamp();
const seen: string[] = [];
for (let turn = 0; turn < 10; turn++) seen.push(step(lamp, turn));
console.log(seen.join(" "));
