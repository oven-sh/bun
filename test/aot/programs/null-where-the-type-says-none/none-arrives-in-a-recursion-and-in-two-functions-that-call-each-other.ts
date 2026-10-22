interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
interface Tree { value: number; left: Tree; right: Tree }
function leaf(value: number): Tree { return { value, left: null as any, right: undefined as any }; }
function total(tree: Tree): number { return tree == null ? 0 : tree.value + total(tree.left) + total(tree.right); }
function depth(tree: Tree): number { if (!tree) return 0; return 1 + Math.max(depth(tree.left), depth(tree.right)); }
function even(tree: Tree): number { return tree === null || tree === undefined ? 0 : tree.value + odd(tree.left); }
function odd(tree: Tree): number { return tree ? even(tree.right) - tree.value : 0; }
function broken(tree: Tree): number { return tree.value + broken(tree.left); }
const tree: Tree = { value: 1, left: { value: 2, left: leaf(3), right: leaf(4) }, right: leaf(5) };
console.log(total(tree), depth(tree), even(tree), odd(tree)); attempt("broken", () => broken(tree));
