interface Part {
  depth: number;
}

function run(body: () => unknown): void {
  try {
    console.log(String(body()));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}

run(() => 1);
run(() => 2);
run(() => 3);
run(() => 4);
run(() => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  delete list[1];
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].depth;
  return total;
});
export {};
