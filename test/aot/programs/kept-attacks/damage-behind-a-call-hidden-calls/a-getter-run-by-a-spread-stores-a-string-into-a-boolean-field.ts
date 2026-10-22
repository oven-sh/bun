// A typed caller reads an object, makes a call and reads it again. A getter, which a spread of its object in the callee runs, stores a string into a boolean field of the object.
class Lamp {
  on: boolean;
  watts: number;
  constructor(on: boolean, watts: number) {
    this.on = on;
    this.watts = watts;
  }
}

let victim: Lamp | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  (target as any).on = "no";
  return true;
}

const source = {
  get level(): number {
    strike();
    return 1;
  },
};
function callee(round: number): number {
  return { ...source }.level + (round & 3);
}

function holder(p: Lamp, round: number): string {
  const before = (p.on ? "lit" : "dark") + p.watts;
  const got = callee(round);
  const after = (p.on ? "lit" : "dark") + "," + (p.on === true) + "," + (p.on === false) + "," + typeof p.on + "," + p.watts;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Lamp = new Lamp((round & 1) === 0, round);
  const before = (p.on ? "lit" : "dark") + p.watts;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = (p.on ? "lit" : "dark") + "," + (p.on === true) + "," + (p.on === false) + "," + typeof p.on + "," + p.watts;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
