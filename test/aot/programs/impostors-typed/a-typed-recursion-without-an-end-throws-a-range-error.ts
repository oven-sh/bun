interface Tree {
  value: number;
  children: Tree[];
}

function sumTree(t: Tree): number {
  let sum = t.value;
  for (let i = 0; i < t.children.length; i++) sum += sumTree(t.children[i]);
  return sum;
}

function countDown(n: number): number {
  return n === 0 ? 0 : 1 + countDown(n - 1);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", String(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

attempt("honest tree", () => sumTree({ value: 1, children: [{ value: 2, children: [] }] }));
attempt("honest count", () => countDown(1000));
attempt("a tree that contains itself", () => {
  const t: Tree = { value: 1, children: [] };
  t.children.push(t);
  return sumTree(t);
});
attempt("a count that never reaches zero", () => countDown(0.5));
attempt("a count from a string", () => countDown(JSON.parse('"3"')));
attempt("honest tree again", () => sumTree({ value: 1, children: [{ value: 2, children: [] }] }));
attempt("honest count again", () => countDown(1000));
