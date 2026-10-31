function memoizeOne<A extends object, T>(callback: (argument: A) => T): (argument: A) => T {
  const known = new Map<A, T>();
  return argument => {
    let value = known.get(argument);
    if (value === undefined) {
      value = callback(argument);
      known.set(argument, value);
    }
    return value;
  };
}
interface Rules {
  depth: number;
}
interface Factory {
  rules: Rules;
  make(kind: number): number;
  count: number;
}
let built = 0;
function rulesOf(): Rules {
  built++;
  return { depth: built };
}
function describe(factory: Factory): string {
  return factory.make(1) + "," + factory.rules.depth + "," + factory.count;
}
const described = memoizeOne(describe);

function ordinary(): Factory {
  const made: Factory = {
    count: 0,
    get rules() {
      return rulesOf();
    },
    make(kind) {
      return kind + super.toString().length;
    },
  };
  return made;
}
console.log(described(ordinary()));
function laidOut(): Factory {
  const made: Factory = {
    count: 0,
    get rules() {
      return rulesOf();
    },
    make(kind) {
      return kind + made.count;
    },
  };
  return made;
}
console.log(described(laidOut()));
function computed(name: string): Factory {
  const made: Factory = {
    [name]: 0,
    get rules() {
      return rulesOf();
    },
    make(kind: number) {
      return kind;
    },
    count: 2,
  };
  return made;
}
console.log(described(computed("extra")), Object.keys(computed("more")).join());
