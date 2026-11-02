// Each variable of a child is turned into a string while Bun.spawnSync runs: getters and traps of `env` run, and toString, valueOf and Symbol.toPrimitive of its values. So are the words of the command.
// The child is this program again. It is handed a word, prints three of its variables and ends.
// Alone: the child gets only the variables that the program makes for it, so in a joined executable it would start at another program
if (process.argv.length > 2) {
  console.log([process.env.A, process.env.B, process.env.C].join());
  process.exit(0);
}
const ran = [];
const again = [
  process.execPath,
  process.argv[1],
  {
    toString() {
      ran.push("word");
      return "child";
    },
  },
];
function start(env) {
  try {
    const child = Bun.spawnSync(again, { env });
    console.log(child.exitCode, child.stdout.toString().trim(), ran.splice(0).join());
  } catch (error) {
    console.log("threw", error instanceof Refusal ? error.mark : error.name, ran.splice(0).join());
  }
}
class Refusal extends Error {
  mark = "marked";
}
class Named {
  toString() {
    ran.push("method");
    return "named";
  }
}
start({
  A: {
    toString() {
      ran.push("toString");
      return "a";
    },
  },
  B: {
    valueOf() {
      ran.push("valueOf");
      return "b";
    },
    toString: null,
  },
  C: {
    [Symbol.toPrimitive](hint) {
      ran.push(hint);
      return "c";
    },
  },
});
start({
  get A() {
    ran.push("getter");
    return "a";
  },
  B: new Named(),
  C: [
    1,
    {
      toString() {
        ran.push("element");
        return "two";
      },
    },
  ],
});
start({ A: 1, B: null, C: undefined, [Symbol("D")]: "no name" });
start(Object.create({ A: "inherited" }, { B: { value: "hidden" }, C: { value: "own", enumerable: true } }));
start(
  new Proxy(
    { A: "a" },
    {
      ownKeys() {
        ran.push("ownKeys");
        return ["A"];
      },
      getOwnPropertyDescriptor(target, key) {
        ran.push("describe");
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key) {
        ran.push("get");
        return "through the proxy";
      },
    },
  ),
);
start({
  A: {
    toString() {
      throw new Refusal("no");
    },
  },
});
start({ A: Symbol("no text") });
start({ A: Object });
