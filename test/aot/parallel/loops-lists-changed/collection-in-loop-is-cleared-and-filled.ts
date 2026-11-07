// Loops walk a Set and a Map and ask them for keys and sizes. In each turn they call a function that reaches the same collections through variables of the module,
// and that function clears and fills again the collections. The turns behind it see them as they are then.
let numbers = new Set<number>();
let prices = new Map<string, number>();
let sink = 0;

function mix(sum: number, next: number): number {
  return (Math.imul(sum, 31) + next) | 0;
}

function numberOf(value: unknown): number {
  return typeof value === "number" ? Math.round(value * 4) : value === undefined ? -7 : typeof value === "string" ? value.length + 1000 : -9;
}

function change(turn: number): void {
  if (turn === 3) {
    numbers.clear();
    prices.clear();
    for (let k = 0; k < 12; k++) {
      numbers.add(300 + k);
      prices.set("c" + k, k);
    }
  }
  sink = (sink + turn) | 0;
}

function changeAndCatch(turn: number): number {
  try {
    change(turn);
    return 0;
  } catch {
    return 1;
  }
}

function walksSet(set: Set<number>): number {
  let sum = 0;
  let turn = 0;
  for (const value of set) {
    sum = mix(sum, changeAndCatch(turn++));
    sum = mix(sum, numberOf(value));
    if (turn > 120) break;
  }
  return mix(sum, set.size);
}

function walksEntries(map: Map<string, number>): number {
  let sum = 0;
  let turn = 0;
  for (const [key, value] of map) {
    sum = mix(sum, numberOf(key) + numberOf(value));
    sum = mix(sum, changeAndCatch(turn++));
    if (turn > 120) break;
  }
  return mix(sum, map.size);
}

function walksKeys(map: Map<string, number>): number {
  let sum = 0;
  let turn = 0;
  for (const key of map.keys()) {
    sum = mix(sum, changeAndCatch(turn++));
    sum = mix(sum, numberOf(key) + numberOf(map.get(key)));
    if (turn > 120) break;
  }
  return sum;
}

function walksValues(map: Map<string, number>): number {
  let sum = 0;
  let turn = 0;
  for (const value of map.values()) {
    sum = mix(sum, numberOf(value));
    sum = mix(sum, changeAndCatch(turn++));
    if (turn > 120) break;
  }
  return sum;
}

function asksAround(set: Set<number>, map: Map<string, number>): number {
  let sum = 0;
  for (let turn = 0; turn < 12; turn++) {
    const key = "k" + (turn & 7);
    sum = mix(sum, numberOf(map.get(key)) + (map.has(key) ? 1 : 0) + (set.has((turn & 7) * 3) ? 2 : 0));
    sum = mix(sum, map.size * 100 + set.size);
    sum = mix(sum, changeAndCatch(turn));
    sum = mix(sum, numberOf(map.get(key)) + (map.has(key) ? 1 : 0) + (set.has((turn & 7) * 3) ? 2 : 0));
    sum = mix(sum, map.size * 100 + set.size);
  }
  return sum;
}

function fill(): void {
  numbers = new Set<number>();
  prices = new Map<string, number>();
  for (let k = 0; k < 8; k++) {
    numbers.add(k * 3);
    prices.set("k" + k, k * 5);
  }
}

for (let round = 0; round < 3; round++) {
  fill();
  console.log("walks a set", walksSet(numbers), sink);
  fill();
  console.log("walks entries", walksEntries(prices), sink);
  fill();
  console.log("walks keys", walksKeys(prices), sink);
  fill();
  console.log("walks values", walksValues(prices), sink);
  fill();
  console.log("asks", asksAround(numbers, prices), sink);
}
