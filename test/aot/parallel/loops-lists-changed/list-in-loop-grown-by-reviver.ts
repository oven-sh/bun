// A loop reads and stores elements of a list and asks for its length. In each turn it calls a function that reaches the same list through a variable of the module,
// and in one turn of many that function parses a text with a reviver that pushes onto the list. The turns behind it see the list as it is then.
let shared: number[] = [];
let sink = 0;

function mix(sum: number, next: number): number {
  return (Math.imul(sum, 31) + next) | 0;
}

function numberOf(value: unknown): number {
  return typeof value === "number" ? Math.round(value * 4) : value === undefined ? -7 : typeof value === "string" ? value.length + 1000 : -9;
}

function change(turn: number): void {
  if (turn === 4) JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12]", (key, value) => {
    shared.push(900 + key.length);
    return value;
  });
  sink = (sink + turn) | 0;
}

function readsAround(list: number[]): number {
  let sum = 0;
  for (let turn = 0; turn < 16; turn++) {
    sum = mix(sum, numberOf(list[turn & 7]));
    try {
      change(turn);
    } catch {
      sum = mix(sum, numberOf(list[9]));
    }
    sum = mix(sum, numberOf(list[(turn + 1) & 7]));
    sum = mix(sum, list.length);
  }
  return sum;
}

function storesAround(list: number[]): number {
  let sum = 0;
  for (let turn = 0; turn < 16; turn++) {
    try {
      list[turn & 3] = turn;
      change(turn);
      list[(turn + 1) & 3] = turn + 20;
    } catch {
      sum = mix(sum, -1);
    }
    sum = mix(sum, list.length);
  }
  for (let k = 0; k < list.length && k < 64; k++) sum = mix(sum, numberOf(list[k]));
  return sum;
}

function walks(list: number[]): number {
  let sum = 0;
  for (let turn = 0; turn < list.length && turn < 70; turn++) {
    try {
      change(turn);
    } catch {
      sum = mix(sum, -2);
    }
    sum = mix(sum, numberOf(list[turn]));
  }
  return sum;
}

function literal(): number[] {
  return [3, 1, 4, 1, 5, 9, 2, 6];
}

function pushed(): number[] {
  const list: number[] = [];
  for (let k = 0; k < 8; k++) list.push(k * 3 + 1);
  return list;
}

for (let round = 0; round < 3; round++) {
  shared = literal();
  console.log("reads a literal", readsAround(shared), sink);
  shared = pushed();
  console.log("reads", readsAround(shared), sink);
  shared = literal();
  console.log("stores into a literal", storesAround(shared), sink);
  shared = pushed();
  console.log("stores", storesAround(shared), sink);
  shared = literal();
  console.log("walks a literal", walks(shared), sink);
  shared = pushed();
  console.log("walks", walks(shared), sink);
}
