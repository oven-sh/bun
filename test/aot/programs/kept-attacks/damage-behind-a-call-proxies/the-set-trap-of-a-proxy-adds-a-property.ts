// A typed caller reads an object, makes a call and reads it again. The set trap of a proxy, which a store to a property in the callee runs, adds a property that the class does not declare.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  (target as any).z = 3;
  return true;
}

const watched = new Proxy(
  { level: 1 },
  {
    set(target, key, value, receiver) {
      strike();
      return Reflect.set(target, key, value, receiver);
    },
  },
);
function callee(round: number): number {
  watched.level = round;
  return round & 3;
}

function holder(p: Point, round: number): string {
  let keysBefore = "";
  for (const key in p) keysBefore += key;
  const before = keysBefore + (p.x + p.y);
  const got = callee(round);
  let keys = "";
  for (const key in p) keys += key;
  const after = keys + "," + p.x + "," + JSON.stringify(p) + "," + Object.keys({ ...p }).length;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  let keysBefore = "";
  for (const key in p) keysBefore += key;
  const before = keysBefore + (p.x + p.y);
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  let keys = "";
  for (const key in p) keys += key;
  const after = keys + "," + p.x + "," + JSON.stringify(p) + "," + Object.keys({ ...p }).length;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
