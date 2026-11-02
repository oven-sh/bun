// Flags: --aot-disable=InlineCalls
// Reflect.construct(..) is the last thing that a function does. Where it constructs, the function stays on the stack. Where it refuses an operand, it is a call in tail position. Each row prints the names and the places of the frames.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(0, 5)
    .map(line =>
      line
        .trim()
        .replace(/\(.*[\\/]/, "(")
        .replace(/^at [^ ]*[\\/]/, "at "),
    )
    .join(" < ");
function Throws() {
  throw new Error("thrown");
}
const arrow = () => 1;
const holder = {
  method() {},
};
function last(callee) {
  return Reflect.construct(callee, []);
}
function lastWithOperands(callee) {
  return Reflect.construct(callee, [1, 2]);
}
function lastWithList(callee, list) {
  return Reflect.construct(callee, list);
}
function kept(callee) {
  return [Reflect.construct(callee, [])];
}
function lastForAnother(callee) {
  return Reflect.construct(Throws, [], callee);
}
function lastWithoutList(callee) {
  return Reflect.construct(callee, 1);
}
function lastAsksForLength(callee) {
  return Reflect.construct(callee, {
    get length() {
      throw new Error("length");
    },
  });
}
function lastThroughProxy(callee) {
  return Reflect.construct(
    new Proxy(callee, {
      construct() {
        throw new Error("trap");
      },
    }),
    [],
  );
}
function lastInBranch(callee) {
  return callee === arrow ? Reflect.construct(callee, []) : Reflect.construct(callee, [1]);
}
function lastBehindAnother(callee) {
  return last(callee);
}
function Constructed(callee) {
  return Reflect.construct(callee, []);
}
const constructs = callee => [new Constructed(callee)];
const inTry = callee => {
  try {
    return Reflect.construct(callee, []);
  } finally {
    holder.method();
  }
};
const ways = [
  last,
  lastWithOperands,
  lastWithList,
  kept,
  lastForAnother,
  lastWithoutList,
  lastAsksForLength,
  lastThroughProxy,
  lastInBranch,
  lastBehindAnother,
  constructs,
  inTry,
];
for (let round = 0; round < 2; round += 1) {
  for (const way of ways) {
    for (const callee of [Throws, arrow, holder.method, Throws.bind(null), {}, 1, undefined]) {
      let end;
      try {
        end = typeof way(callee, []);
      } catch (error) {
        end = frames(error);
      }
      console.log(round, way.name, typeof callee === "function" ? callee.name : String(callee), end);
    }
  }
}
