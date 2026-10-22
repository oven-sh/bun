// One site sees objects of three classes that stand below each other, so its test speaks of three prototype chains at once. A callee leaves its typed path and puts the name on the prototype object in the middle:
// objects of the class in the middle and of the one below find it, objects of the one above do not. Then the same on the lowest class under another name.
class Base {
  id: number;
  declare owner?: string;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}
class Middle extends Base {
  width: number;
  constructor(id: number) {
    super(id);
    this.width = id + 1;
  }
}
class Leaf extends Middle {
  depth: number;
  constructor(id: number) {
    super(id);
    this.depth = id + 2;
  }
}

let damage = 0;
const bomb = {
  valueOf(): number {
    if (damage === 1) (Middle.prototype as any).owner = "owner from the middle";
    else if (damage === 2) (Leaf.prototype as any).note = "note from the leaf";
    return 2;
  },
};

let factor: number = 2;
function callee(round: number): number {
  return factor * (round & 3);
}

function holder(a: Base, b: Base, c: Base, round: number): string {
  const before = a.owner + "," + b.owner + "," + c.owner + "," + c.note;
  const got = callee(round);
  return before + " " + got + " " + a.owner + "," + b.owner + "," + c.owner + " " + a.note + "," + b.note + "," + c.note;
}

let digest = 0;
for (let round = 0; round < 400; round++) {
  const objects: Base[] = [new Base(round), new Middle(round), new Leaf(round)];
  if (round % 5 === 0) objects[round % 3].owner = "o" + round;
  damage = round === 200 ? 1 : round === 300 ? 2 : 0;
  if (damage) factor = bomb as any;
  const line = holder(objects[round % 3], objects[(round + 1) % 3], objects[(round + 2) % 3], round);
  factor = 2;
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 3 || (round >= 199 && round <= 203) || (round >= 299 && round <= 303)) console.log(round + ": " + line);
}
console.log("digest " + digest);
