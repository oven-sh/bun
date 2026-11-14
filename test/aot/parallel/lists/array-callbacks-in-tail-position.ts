// STATISTIC: ArrayCallbacksRunByStubs >= 8
// Declared arrays off JSON. The call of the method is all that a function returns, and the objects have no declared layout when the program runs.

interface Item {
  id: number;
  name: string;
  ok: boolean;
  half: number;
}

const parse = (text: string): Item[] => JSON.parse(text);
const items = (length: number): Item[] => parse(JSON.stringify(Array.from({ length }, (_, i) => ({ id: i, name: "n" + i, ok: i === 5, half: i / 2 }))));
let seen = 0;

// The functions are too large to be copied into the loop.
function total(list: Item[], turn: number): number {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.reduce((sum, x) => sum + x.id, 0);
}
function totalOfHalves(list: Item[], turn: number): number {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.reduce((sum, x) => sum + x.half, 0);
}
function find(list: Item[], turn: number, id: number): Item | undefined {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.find(x => x.id === id);
}
function findByName(list: Item[], turn: number, name: string): Item | undefined {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.find(x => x.name === name);
}
function place(list: Item[], turn: number): number {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.findIndex(x => x.ok);
}
function some(list: Item[], turn: number, id: number): boolean {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.some(x => x.id === id);
}
function every(list: Item[], turn: number): boolean {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.every(x => x.name);
}
function kept(list: Item[], turn: number): Item[] {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.filter(x => !x.ok);
}
function above(list: Item[], turn: number, id: number): Item[] {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.filter(x => x.id > id);
}
function names(list: Item[], turn: number): string[] {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x.name);
}
function halves(list: Item[], turn: number): number[] {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x.half);
}

function show(answer: unknown): string {
  if (Array.isArray(answer)) return answer.length + ":" + answer.map(x => x?.id ?? x).join("/");
  return typeof answer === "object" && answer ? "o" + (answer as Item).id : Object.is(answer, -0) ? "-0" : String(answer);
}

const lists: Item[][] = [
  items(8),
  items(0),
  parse('[{"id":1,"name":"n1","half":0.5},{"name":"n4","id":2,"half":1},{"z":1,"name":"","id":3,"ok":true,"half":7}]'),
  parse('[{"id":1,"name":"a"},null,{"id":2,"name":"b"}]'),
  parse('[{"id":"1","name":2,"half":"x"},{"id":2,"name":"b","half":1}]'),
  parse('[{"0":1,"id":1,"name":"a","half":-0,"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"ok":true}]'),
  items(4),
  items(3),
  items(5),
];
const changes: ((list: Item[]) => unknown)[] = [
  () => {},
  list => delete list[1],
  list => Object.freeze(list),
  list => list.push(new Proxy({ id: 3, name: "p" } as Item, { get: (target, key) => (seen++, Reflect.get(target, key)) })),
  list => list.push({ get id() { return ++seen; }, name: "g", ok: false, half: 2 }),
];

for (let round = 0; round < 6; round++)
  for (let index = 0; index < lists.length; index++) {
    const list = lists[index];
    const answers: string[] = [];
    if (round === 3) changes[index % changes.length](list);
    try {
      answers.push(show(total(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(totalOfHalves(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(find(list, round, 3)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(findByName(list, round, "n4")));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(place(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(some(list, round, 2)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(every(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(kept(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(above(list, round, 2)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(names(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    try {
      answers.push(show(halves(list, round)));
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
    console.log(answers.join(" "));
  }
console.log(seen);
