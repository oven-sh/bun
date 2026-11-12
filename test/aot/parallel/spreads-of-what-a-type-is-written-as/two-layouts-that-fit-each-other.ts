type Found = { file: string };
type Result = { file: string; root?: string; verbatim?: boolean };
function written(found: Found): Result { return { ...found, verbatim: true }; }
function again(result: Result, root: string): Result { return { ...result, root }; }
(globalThis as any).keep = [written, again];
const [mark, rooted]: [typeof written, typeof again] = (globalThis as any).keep;
const founds: Found[] = [{ file: "a" }, { file: "b" }];
const texts = new Set<string>();
for (let i = 0; i < 4000; i++) {
  const marked = mark(founds[i & 1]);
  const twice = mark(marked);
  const deep = rooted(i & 2 ? marked : founds[i & 1], "r" + (i & 1));
  texts.add(JSON.stringify(marked) + Object.keys(twice).join() + JSON.stringify(deep) + Object.keys(rooted(deep, "s")).join() + (marked === twice));
}
console.log([...texts].join(" "));
console.log(JSON.stringify(mark({ verbatim: false, file: "d" } as Found)), JSON.stringify(rooted({ root: "x", file: "e" }, "y")), JSON.stringify(mark(Object.freeze({ file: "g" }))));
