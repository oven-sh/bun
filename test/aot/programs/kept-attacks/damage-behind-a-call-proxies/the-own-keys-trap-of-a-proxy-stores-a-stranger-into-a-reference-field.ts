// A typed caller reads an object, makes a call and reads it again. The ownKeys trap of a proxy, which Object.keys in the callee runs, stores an object of another shape into a field that is declared to hold an instance of a class.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
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
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    (target as any).leaf = { other: 1, value: "stranger" };
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

const watched = new Proxy(
  { level: 1 },
  {
    ownKeys(target) {
      strike();
      return Reflect.ownKeys(target);
    },
  },
);
function callee(round: number): number {
  return Object.keys(watched).length + (round & 3);
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
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
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
