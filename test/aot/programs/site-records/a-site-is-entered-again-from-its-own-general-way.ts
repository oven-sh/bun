// A getter, a setter or a method that a site reaches on its general way sends other objects through the very same site before it returns. What the inner visits teach the site does not disturb the outer one, and the other way round.
interface Node {
  name: unknown;
  visit(depth: number): unknown;
}

const trail: string[] = [];

function nameOf(node: Node): unknown {
  return node.name;
}
function rename(node: Node, name: unknown): void {
  node.name = name;
}
function visit(node: Node, depth: number): unknown {
  return node.visit(depth);
}

class Plain implements Node {
  name: unknown = "plain";
  visit(depth: number): unknown {
    return "plain at " + depth;
  }
}
class Shifted implements Node {
  pad = 0;
  name: unknown = "shifted";
  visit(depth: number): unknown {
    return "shifted at " + depth;
  }
}

function parsed(text: string): Node {
  return Object.assign(JSON.parse('{"' + text + '":0,"name":"parsed ' + text + '"}'), { visit: (depth: number) => "parsed " + text + " at " + depth });
}

function chained(depth: number): Node {
  let stored: unknown = "chained " + depth;
  return {
    get name() {
      const inner = depth > 0 ? nameOf(chained(depth - 1)) : [nameOf(new Plain()), nameOf(new Shifted()), nameOf(parsed("p")), nameOf(new Plain())].join("+");
      return String(stored) + "(" + String(inner) + ")";
    },
    set name(value: unknown) {
      trail.push("set " + depth);
      if (depth > 0) rename(chained(depth - 1), value);
      else {
        const targets = [new Plain(), new Shifted(), parsed("q")];
        rename(targets[0], value);
        rename(targets[1], value);
        rename(targets[2], value);
        trail.push(targets.map(target => JSON.stringify(target)).join());
      }
      stored = value;
    },
    visit(level: number) {
      const inner = level > 0 ? visit(this, level - 1) : [visit(new Plain(), 0), visit(new Shifted(), 0), visit(parsed("r"), 0)].join("+");
      return "chained " + depth + "." + level + "(" + String(inner) + ")";
    },
  };
}

console.log(nameOf(new Plain()), nameOf(chained(0)), nameOf(new Plain()));
console.log(nameOf(chained(3)));
console.log(nameOf(new Shifted()), nameOf(parsed("s")), nameOf(chained(1)), nameOf(parsed("s")), nameOf(new Shifted()));

const outer = chained(2);
rename(outer, "renamed");
console.log(nameOf(outer), trail.splice(0).join(" "));
const plain = new Plain();
rename(plain, "renamed plain");
console.log(JSON.stringify(plain));

console.log(visit(new Plain(), 1), "|", visit(chained(0), 0), "|", visit(chained(1), 3), "|", visit(new Shifted(), 2), "|", visit(parsed("t"), 4));

const selfChanging: Node = {
  get name() {
    Object.defineProperty(this, "name", { value: "settled", writable: true, enumerable: true, configurable: true });
    return "first, then " + String(nameOf(this));
  },
  visit(depth: number) {
    this.visit = () => "replaced itself";
    return "first, then " + String(visit(this, depth));
  },
};
console.log(nameOf(selfChanging), "|", nameOf(selfChanging), "|", visit(selfChanging, 0), "|", visit(selfChanging, 0));

function throwing(): Node {
  return {
    get name(): unknown {
      nameOf(new Shifted());
      throw new RangeError("from the getter");
    },
    visit() {
      visit(new Shifted(), 0);
      throw new EvalError("from the method");
    },
  };
}
for (const run of [() => nameOf(throwing()), () => visit(throwing(), 0), () => nameOf(new Plain()), () => visit(new Plain(), 0)]) {
  try {
    console.log(String(run()));
  } catch (error) {
    console.log("throws", (error as Error).constructor.name);
  }
}

export {};
