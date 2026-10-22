// A typed caller reads an object, makes a call and reads it again. The getPrototypeOf trap of a proxy, which an instanceof in the callee runs, gives the object, which an object literal has made, a prototype that has the name of an optional field that the object does not have.
type Pair = { left: number; right: number; note?: string };

let victim: Pair | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  Object.setPrototypeOf(target, { note: "inherited" });
  return true;
}

class Marker {}
const watched = new Proxy(new Marker(), {
  getPrototypeOf(target) {
    strike();
    return Reflect.getPrototypeOf(target);
  },
});
function callee(round: number): number {
  return watched instanceof Marker ? round & 3 : -1;
}

function holder(p: Pair, round: number): string {
  const before = p.left + p.right + ":" + p.note;
  const got = callee(round);
  const after = p.note + "," + p.left + "," + ("note" in p) + "," + Object.keys(p).join("");
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Pair = { left: round, right: round + 1 };
  const before = p.left + p.right + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = p.note + "," + p.left + "," + ("note" in p) + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
