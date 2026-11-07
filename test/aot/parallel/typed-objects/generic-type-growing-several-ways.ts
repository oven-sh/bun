// A generic type that holds larger instantiations of itself in several members. Every path of members is a new type, so the types n members deep
// number (members)^n: the compiler has to stop giving them layouts long before eight levels of each kind of growth.
declare const console: { log(...values: unknown[]): void };
interface Tree<T> { leaf: T; left?: Tree<[T]>; right?: Tree<{ of: T }>; up?: Tree<T[]>; down?: Tree<() => T> }
type Choice<T> = T extends string
  ? { text: T; left?: Choice<[T]>; right?: Choice<{ of: T }>; up?: Choice<T[]>; down?: Choice<() => T> }
  : { other: T; left?: Choice<[T]>; right?: Choice<{ of: T }>; up?: Choice<T[]>; down?: Choice<() => T> };

function size(tree: { left?: unknown; right?: unknown; up?: unknown; down?: unknown } | undefined): number {
  if (!tree) return 0;
  return 1 + size(tree.left as typeof tree) + size(tree.right as typeof tree) + size(tree.up as typeof tree) + size(tree.down as typeof tree);
}
function keys<T>(seed: T, choice: Choice<T> | undefined): string { return Object.keys(choice ?? {}).join(); }

const tree: Tree<string> = {
  leaf: "a",
  left: { leaf: ["b"], right: { leaf: { of: ["c"] }, up: { leaf: [{ of: ["d"] }], down: { leaf: () => [{ of: ["e"] }] } } } },
  up: { leaf: ["f"], up: { leaf: [["g"]], up: { leaf: [[["h"]]], up: { leaf: [[[["i"]]]], up: { leaf: [[[[["j"]]]]] } } } } },
};
console.log(size(tree), tree.left?.right?.leaf.of[0], tree.left?.right?.up?.leaf[0].of[0], tree.left?.right?.up?.down?.leaf()[0].of[0]);
console.log(tree.up?.up?.up?.up?.up?.leaf[0][0][0][0][0], JSON.stringify(tree.up?.up?.up));
console.log(keys("s" as string, { text: "x", left: { other: ["y"] } }), keys(1 as number, { other: 2, up: { other: [3], right: { other: { of: [4] } } } }));
const parsed: Tree<number> = JSON.parse('{"leaf":1,"left":{"leaf":[2],"left":{"leaf":[[3]],"left":{"leaf":[[[4]]],"left":{"leaf":[[[[5]]]],"left":{"leaf":[[[[[6]]]]]}}}}}}');
console.log(size(parsed), parsed.left?.left?.left?.left?.left?.leaf[0][0][0][0][0]);
