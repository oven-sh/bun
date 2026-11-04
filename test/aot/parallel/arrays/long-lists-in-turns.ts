// Each turn of a short loop makes a long list of its own, also where the turns are written out one behind the other and the loop goes on behind them. A long list may begin with what a catch has caught.
let made = 0;
function item(turn: string | number): string {
  return turn + "#" + made++;
}

function counted(): string[][] {
  const lists: string[][] = [];
  for (let turn = 0; turn < 3; turn++) {
    // prettier-ignore
    lists.push([
      item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn),
      item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn),
      item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn), item(turn),
      item(turn), item(turn), item(turn), item(turn),
    ]);
  }
  return lists;
}

function named(record: { a: number; b: number }): string[][] {
  const lists: string[][] = [];
  for (const name in record) {
    // prettier-ignore
    lists.push([
      item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name),
      item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name),
      item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name), item(name),
      item(name), item(name), item(name), item(name),
    ]);
  }
  return lists;
}

function caught(fail: () => void, scale: { factor: number }): unknown[] {
  try {
    fail();
  } catch (error) {
    // prettier-ignore
    return [
      error, item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"),
      item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"),
      item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"), item("c"),
      item("c"), item("c"), item("c"), item("c"), scale.factor * 2,
    ];
  }
  return [];
}

function show(lists: string[][]) {
  console.log(lists.length, new Set(lists).size);
  for (const list of lists) console.log(list.length, list.join(" "));
}

show(counted());
show(named({ a: 1, b: 2 }));
show(named(Object.setPrototypeOf({ a: 1, b: 2 }, { inherited: 3, inheritedToo: 4 })));
console.log(
  caught(
    () => {
      throw "thrown";
    },
    { factor: 21 },
  ).join(" "),
);
console.log(caught(() => {}, { factor: 21 }).length);
