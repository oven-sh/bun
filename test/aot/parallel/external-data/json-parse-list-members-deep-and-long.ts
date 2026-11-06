interface Tree { name: string; size: number; children: Tree[] }
interface Chain { id: number; next: Chain | null }
interface Rows { name: string; rows: number[][] }
const parseTree = (text: string) => JSON.parse(text) as Tree;
const parseChain = (text: string) => JSON.parse(text) as Chain;
const parseRows = (text: string) => JSON.parse(text) as Rows;
const depthOf = (tree: Tree) => { let depth = 0; for (let node: Tree | undefined = tree; node; node = node.children[node.children.length - 1]) depth++; return depth; };
const sizes = (tree: Tree) => { let sum = 0; const stack = [tree]; while (stack.length) { const node = stack.pop()!; sum += node.size; for (const child of node.children) stack.push(child); } return sum; };
const lengthOf = (chain: Chain) => { let length = 0; for (let node: Chain | null = chain; node; node = node.next) length++; return length; };

type Form = (inner: string, level: number) => string;
const forms: Record<string, Form> = {
  "more in front": (inner, level) => `{"name":"n","k":1,"size":${level},"children":[${inner}]}`,
  "more behind": (inner, level) => `{"name":"n","size":${level},"children":[${inner}],"k":1}`,
  "more on both sides": (inner, level) => `{"name":"n","k":1,"size":${level},"children":[${inner}],"o":1}`,
  "two forms in turn": (inner, level) => `{"name":"n","k":1,"size":${level},"children":[${inner}],"${level & 1 ? "a" : "b"}":1}`,
  "three forms in turn": (inner, level) => `{"name":"n","k":1,"size":${level},"children":[${inner}],"${"abc"[level % 3]}":1}`,
  "a leaf beside each": (inner, level) => `{"name":"n","k":1,"size":${level},"children":[{"name":"l","k":1,"size":1,"children":[]}${inner ? "," + inner : ""}]}`,
  "a leaf of another form beside each": (inner, level) => `{"name":"n","k":1,"size":${level},"children":[{"name":"l","q":1,"size":1,"children":[]}${inner ? "," + inner : ""}]}`,
  "another first key in turn": (inner, level) => (level & 1 ? `{"name":"n","k":1,"size":${level},"children":[${inner}]}` : `{"k":1,"name":"n","size":${level},"children":[${inner}]}`),
  "no more": (inner, level) => `{"name":"n","size":${level},"children":[${inner}]}`,
};
const nest = (form: Form, depth: number, bottom = "") => { let text = bottom; for (let level = 1; level <= depth; level++) text = form(text, level); return text; };
for (const [label, form] of Object.entries(forms)) {
  for (const depth of [1, 2, 3, 4, 8, 50, 400, 1500]) {
    let line = "";
    for (let round = 0; round < 5; round++) {
      const tree = parseTree(nest(form, depth));
      line = depthOf(tree) + " " + sizes(tree);
    }
    console.log(label, depth, line);
  }
  for (const bottom of [`{"odd":1}`, `1`, `{"name":"n","k":1,"size":0,"children":[[]]}`, `{"name":"n","k":1,"size":0,"children":{}}`, `{"name":"n","k":1,"size":0,"children":[`, `]`]) {
    let line = "";
    for (let round = 0; round < 3; round++) {
      try {
        line = JSON.stringify(parseTree(nest(form, 300, bottom))).length + "";
      } catch (error) {
        line = (error as Error).name + ": " + (error as Error).message;
      }
    }
    console.log(label, "bottom", bottom, line);
  }
}
for (const [label, form] of Object.entries({
  "chain, more behind": (inner: string, level: number) => `{"id":${level},"next":${inner},"x":1}`,
  "chain, more in front": (inner: string, level: number) => `{"x":1,"id":${level},"next":${inner}}`,
  "chain, two forms": (inner: string, level: number) => `{"x":1,"id":${level},"next":${inner},"${level & 1 ? "a" : "b"}":1}`,
})) {
  for (const depth of [1, 2, 3, 10, 400, 1500]) {
    let line = 0;
    for (let round = 0; round < 5; round++) line = lengthOf(parseChain(nest(form, depth, "null")));
    console.log(label, depth, line);
  }
}
for (const depth of [1, 2, 3, 4, 5, 6, 40, 3000]) {
  let line = "";
  for (let round = 0; round < 4; round++) {
    try {
      line = JSON.stringify(parseRows(`{"name":"n","k":1,"rows":${"[".repeat(depth)}1${"]".repeat(depth)},"o":1}`)).length + "";
    } catch (error) {
      line = (error as Error).name + ": " + (error as Error).message;
    }
  }
  console.log("lists in lists", depth, line);
}
const wide = (count: number, each: (index: number) => string) => { const parts: string[] = []; for (let i = 0; i < count; i++) parts.push(each(i)); return parts.join(); };
for (const count of [7, 8, 9, 16, 17, 1000, 20000]) {
  let line = "";
  for (let round = 0; round < 4; round++) {
    const tree = parseTree(`{"name":"r","k":1,"size":0,"children":[${wide(count, i => `{"name":"c${i % 10}","k":1,"size":${i},"children":[]}`)}],"o":1}`);
    const rows = parseRows(`{"name":"r","k":1,"rows":[[${wide(count, i => String(i))}],[${wide(count, i => i + ".5")}]],"o":1}`);
    line = tree.children.length + " " + sizes(tree) + " " + rows.rows[0].length + " " + rows.rows[0][count - 1] + " " + rows.rows[1][count - 1];
  }
  console.log("wide", count, line);
}
