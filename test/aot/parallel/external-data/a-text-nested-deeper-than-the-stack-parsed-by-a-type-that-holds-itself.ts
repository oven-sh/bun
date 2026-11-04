// A written type holds itself, and the text is nested a few levels, thousands of levels and more than any stack has room for: the parse gives what JSON.parse gives, and never an error of the stack.
type Tree = { value: number; next: Tree | null };
type Lists = Lists[];
function tree(text: string) { return JSON.parse(text) as Tree; }
function lists(text: string) { return JSON.parse(text) as Lists; }
function depthOfTree(t: Tree | null) { let depth = 0; for (; t; t = t.next) depth += t.value; return depth; }
function depthOfLists(l: Lists) { let depth = 0; for (; l.length; l = l[0]) depth++; return depth; }
for (const depth of [1, 2, 10, 1000, 20000, 200000]) {
  const text = '{"value":1,"next":'.repeat(depth) + "null" + "}".repeat(depth);
  try { console.log("tree", depth, depthOfTree(tree(text))); } catch (error) { console.log("tree", depth, (error as Error).name); }
  const nested = "[".repeat(depth + 1) + "]".repeat(depth + 1);
  try { console.log("lists", depth, depthOfLists(lists(nested))); } catch (error) { console.log("lists", depth, (error as Error).name); }
}
