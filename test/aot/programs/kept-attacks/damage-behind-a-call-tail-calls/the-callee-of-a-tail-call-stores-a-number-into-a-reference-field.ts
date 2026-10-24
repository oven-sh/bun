// A typed caller reads an object, makes a call and reads it again. A function that the callee calls in tail position, so that it returns in the callee's place, stores a number into a field that is declared to hold an object.
class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Branch {
  leaf: Leaf;
  weight: number;
  constructor(leaf: Leaf, weight: number) {
    this.leaf = leaf;
    this.weight = weight;
  }
}

let victim: Branch | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  (target as any).leaf = 17;
  return true;
}

function last(round: number): number {
  strike();
  return round & 3;
}
function callee(round: number): number {
  return last(round + 4);
}

function holder(p: Branch, round: number): string {
  const leaf = p.leaf;
  const before = leaf.value + p.weight;
  const got = callee(round);
  let through: string;
  try {
    through = String(p.leaf.value);
  } catch (error) {
    through = (error as Error).name;
  }
  const after = through + "," + leaf.value + "," + (p.leaf === leaf) + "," + p.weight;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Branch = new Branch(new Leaf(round), round + 1);
  const leaf = p.leaf;
  const before = leaf.value + p.weight;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  let through: string;
  try {
    through = String(p.leaf.value);
  } catch (error) {
    through = (error as Error).name;
  }
  const after = through + "," + leaf.value + "," + (p.leaf === leaf) + "," + p.weight;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
