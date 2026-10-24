// A typed caller reads an object, makes a call and reads it again. The valueOf method of an object that is passed where the callee declares a number deletes a field of the inner object, which the caller has read out of a field and still holds.
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
  delete (target.leaf as any).value;
  return true;
}

const heavy: any = {
  valueOf(): number {
    strike();
    return 2;
  },
};
function callee(weight: number, round: number): number {
  return weight * 2 + (round & 3);
}

function holder(p: Branch, round: number): string {
  const leaf = p.leaf;
  const before = leaf.value + p.weight;
  const got = callee(round % 50 < 2 || round === 299 ? heavy : 2, round);
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
