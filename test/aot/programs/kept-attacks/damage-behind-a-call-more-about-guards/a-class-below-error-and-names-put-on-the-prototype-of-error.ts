// The class has a built-in parent. A name that it does not declare is looked for there too, and nobody watches there for the class, so the condition on such a name has no bit and its test never passes.
// The same function calls a method and reads a getter that the class does declare. Whatever is done with the tests of one function, the answers stay those of the language:
// a callee leaves its typed path and puts one absent name on Error.prototype, later another on the prototype object of the class, and at last replaces the method.
class Failure extends Error {
  code: number;
  declare hint?: string;
  declare cause2?: string;
  constructor(code: number) {
    super("failure " + code);
    this.code = code;
  }
  label(): string {
    return "F" + this.code;
  }
  get twice(): number {
    return this.code * 2;
  }
}

let damage = 0;
const bomb = {
  valueOf(): number {
    if (damage === 1) (Error.prototype as any).hint = "hint from Error";
    else if (damage === 2) (Failure.prototype as any).cause2 = "cause from Failure";
    else if (damage === 3) (Failure.prototype as any).label = () => "replaced";
    return 2;
  },
};

let factor: number = 2;
function callee(round: number): number {
  return factor * (round & 3);
}

function holder(p: Failure, round: number): string {
  const before = p.label() + "," + p.twice + "," + p.hint + "," + p.cause2;
  const got = callee(round);
  return before + " " + got + " " + p.label() + "," + p.twice + "," + p.hint + "," + p.cause2 + "," + p.message;
}

let digest = 0;
for (let round = 0; round < 500; round++) {
  const p = new Failure(round);
  if (round % 5 === 0) p.hint = "h" + round;
  damage = round === 201 ? 1 : round === 302 ? 2 : round === 401 ? 3 : 0;
  if (damage) factor = bomb as any;
  const line = holder(p, round);
  factor = 2;
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || round % 100 <= 3 || round % 100 === 99) console.log(round + ": " + line);
  if (round === 250) delete (Error.prototype as any).hint;
}
console.log("digest " + digest);
