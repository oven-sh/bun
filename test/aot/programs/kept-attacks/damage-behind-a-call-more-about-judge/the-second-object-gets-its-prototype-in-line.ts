// A typed caller calls a method of an object, makes a direct call and calls the method again. The callee gives the object another prototype with Object.setPrototypeOf, on its typed path.
// The first such change goes through the host function, which records the transition from this Structure to this prototype. From the second object on compiled code finds the transition
// and stores the Structure and the flag of the cell IN LINE (ObjectBuiltinEmitter::generateSetPrototypeOf). Whoever writes there has to send the returns on the stack to their landings:
// the caller holds "the object has the prototype of its layout" across the call. If nobody is told, the caller calls the method of the class from the second strike on.
// Reflect.setPrototypeOf takes the same way. `relay` and `strike` call each other, so that neither is copied into `holder`.
class Animal {
  legs: number;
  constructor(legs: number) {
    this.legs = legs;
  }
  name(): string {
    return "animal";
  }
  get twice(): number {
    return this.legs * 2;
  }
}
const stranger = {
  name(): string {
    return "stranger";
  },
  get twice(): number {
    return -1;
  },
};
const other = {
  name(): string {
    return "other";
  },
  get twice(): number {
    return -2;
  },
};

function relay(target: Animal, way: number, depth: number): number {
  return strike(target, way, depth - 1) + 1;
}
function strike(target: Animal, way: number, depth: number): number {
  if (depth > 0) return relay(target, way, depth);
  if (way === 1) Object.setPrototypeOf(target, stranger);
  else if (way === 2) Reflect.setPrototypeOf(target, other);
  return target.legs;
}

function holder(a: Animal, way: number, depth: number): string {
  const before = a.name() + "," + a.twice;
  const got = strike(a, way, depth);
  return before + " " + got + " " + a.name() + "," + a.twice + "," + a.legs + "," + (a instanceof Animal);
}

function outer(round: number, way: number): string {
  const a = new Animal(round & 7);
  const first = a.name();
  const line = holder(a, way, round & 3);
  return first + " " + line + " " + a.name();
}

let digest = 0;
for (let round = 0; round < 600; round++) {
  const way = round % 50 === 49 ? 1 : round % 70 === 69 ? 2 : 0;
  const line = outer(round, way);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (way || round < 2) console.log(round + ": " + line);
}
console.log("digest " + digest);
