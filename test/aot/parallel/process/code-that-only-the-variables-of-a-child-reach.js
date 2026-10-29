// Nothing but the call of Bun.spawnSync reaches the getter, the traps and the conversions below: they are compiled because the call runs them, and nothing else of the library comes along.
// STATISTIC: ImageFunctionsEmitted <= 30
// The child is this program again. It is handed a word and ends at once.
// Alone: the child gets only the variables that the program makes for it, so in a joined executable it would start at another program
if (process.argv.length > 2) process.exit(0);
let ran = 0;
const again = [
  process.execPath,
  process.argv[1],
  {
    toString() {
      ran += 1;
      return "child";
    },
  },
];
Bun.spawnSync(again, {
  stdout: "ignore",
  env: {
    get A() {
      ran += 10;
      return "a";
    },
  },
});
Bun.spawnSync(again, {
  stdout: "ignore",
  env: {
    A: {
      toString() {
        ran += 100;
        return "a";
      },
    },
    B: {
      valueOf() {
        ran += 1000;
        return "b";
      },
      toString: null,
    },
  },
});
Bun.spawnSync(again, {
  stdout: "ignore",
  env: {
    A: {
      [Symbol.toPrimitive]() {
        ran += 10000;
        return "a";
      },
    },
    B: [
      {
        toString() {
          ran += 100000;
          return "b";
        },
      },
    ],
  },
});
Bun.spawnSync({
  cmd: again,
  stdout: "ignore",
  env: new Proxy(
    { A: "a" },
    {
      ownKeys() {
        ran += 1000000;
        return ["A"];
      },
      getOwnPropertyDescriptor() {
        ran += 10000000;
        return { value: "a", enumerable: true, configurable: true, writable: true };
      },
      get() {
        ran += 100000000;
        return "a";
      },
    },
  ),
});
console.log(ran);
