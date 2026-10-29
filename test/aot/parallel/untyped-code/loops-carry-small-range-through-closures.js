// A walk that answers 0, 1 or 2. The answer lives in a variable that closures raise, and loops over keys and elements carry it once the closures are part of the walk.
const NONE = 0;
const ASSUMED = 1;
const PROVEN = 2;
const known = new WeakMap();

function walk(node, stack, resolve) {
  const cached = known.get(node);
  if (cached !== undefined) return cached ? PROVEN : NONE;
  if (stack.has(node)) return PROVEN;
  stack.add(node);
  let result = NONE;
  const check = child => {
    if (result !== PROVEN && child?.kind) {
      const answer = walk(child, stack, resolve);
      if (answer > result) result = answer;
    }
  };
  const shape = (members, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(members)) {
      const descriptor = Object.getOwnPropertyDescriptor(members, key);
      if (spread && !descriptor.enumerable) continue;
      const child = descriptor.get ? ASSUMED : descriptor.value?.kind ? walk(descriptor.value, stack, resolve) : NONE;
      if (child > answer) answer = child;
    }
    return answer;
  };
  const merge = answer => {
    if (answer > result) result = answer;
  };
  switch (node.kind) {
    case "object":
      merge(node.members ? shape(node.members, true) : ASSUMED);
      check(node.rest);
      break;
    case "list":
      for (const element of node.items) check(element);
      check(node.rest);
      break;
    case "choice":
      for (const option of node.options) check(option);
      break;
    case "pair":
      check(node.left);
      check(node.right);
      break;
    case "late": {
      const inner = node.inner ?? (resolve ? node.make() : undefined);
      merge(inner ? walk(inner, stack, false) : ASSUMED);
      break;
    }
    default:
      for (const key in node) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor) continue;
        if (descriptor.get) {
          merge(ASSUMED);
          continue;
        }
        check(descriptor.value);
      }
  }
  stack.delete(node);
  if (result !== ASSUMED) known.set(node, result === PROVEN);
  return result;
}

function leaf(name) {
  return { kind: "text", name };
}
function build(depth, width) {
  if (depth === 0) return leaf("leaf" + width);
  const members = {};
  for (let i = 0; i < width; i++) members["m" + i] = build(depth - 1, width);
  Object.defineProperty(members, "hidden", { value: leaf("hidden"), enumerable: false });
  return {
    kind: "object",
    members,
    rest: { kind: "list", items: [leaf("a"), { kind: "pair", left: leaf("l"), right: leaf("r") }], rest: undefined },
  };
}

const lines = [];
const tree = build(4, 3);
lines.push("tree " + walk(tree, new Set(), true));
const cyclic = { kind: "choice", options: [leaf("x")] };
cyclic.options.push({ kind: "list", items: [cyclic], rest: undefined });
lines.push("cycle " + walk(cyclic, new Set(), true));
const getter = { kind: "object", members: { get later() { return leaf("later"); } }, rest: undefined };
lines.push("getter " + walk(getter, new Set(), true));
const late = { kind: "late", inner: undefined, make: () => leaf("made") };
lines.push("late, resolved " + walk(late, new Set(), true) + ", not resolved " + walk({ kind: "late", inner: undefined, make: late.make }, new Set(), false));
const other = { kind: "other", first: leaf("first"), second: cyclic, get third() { return 1; } };
lines.push("other " + walk(other, new Set(), true));
let total = 0;
for (let round = 0; round < 300; round++) total += walk(build(3, 3), new Set(), true) + walk({ kind: "other", a: build(1, 2), b: getter }, new Set(), true);
lines.push("rounds " + total);
console.log(lines.join("\n"));
