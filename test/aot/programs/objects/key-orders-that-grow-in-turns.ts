// Objects of two declared types get their optional fields in turns, in orders that the build has not seen, so that the orders of several objects grow at the same time. Others are created whole, with a
// list of keys that goes on, by several keys at once, where the list of an earlier object ends, or leave an order that the build has seen halfway. Each lists its own keys in the order of creation, however it is asked.
type Bag = {
  a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number; k?: number; l?: number;
  m?: number; n?: number; o?: number; p?: number; q?: number; r?: number; s?: number; t?: number; u?: number; v?: number; w?: number; x?: number;
};
type Box = {
  a?: string; b?: string; c?: string; d?: string; e?: string; f?: string; g?: string; h?: string; i?: string; j?: string; k?: string; l?: string;
  m?: string; n?: string; o?: string; p?: string; q?: string; r?: string; s?: string; t?: string; u?: string; v?: string; w?: string; x?: string;
};
type Name = keyof Bag;

const letters = "abcdefghijklmnopqrstuvwx";

function bagOf(names: string): Bag {
  return JSON.parse("{" + [...names].map((name, index) => JSON.stringify(name) + ":" + index).join(",") + "}");
}
function copyOf(from: Bag): Bag {
  return { ...from };
}
function add(to: Bag, names: string): Bag {
  for (const name of names) to[name as Name] = name.charCodeAt(0);
  return to;
}
function keysOf(object: object): string {
  const byForIn: string[] = [];
  for (const key in object) byForIn.push(key);
  const ways = [
    Object.keys(object).join(""),
    byForIn.join(""),
    Object.entries(object).map(([key]) => key).join(""),
    Object.getOwnPropertyNames(object).join(""),
    Reflect.ownKeys(object).join(""),
    Object.keys({ ...object }).join(""),
    Object.keys(Object.assign({}, object)).join(""),
    Object.keys(JSON.parse(JSON.stringify(object))).join(""),
  ];
  return ways.every(way => way === ways[0]) ? ways[0] || "-" : "the ways differ: " + ways.join(" ");
}

const orders = ["xwvutsrqponmlkjihgfedcba", "axbwcvduetfsgrhqipjoknlm", "mlkjihgfedcbaxwvutsrqpon", "axbwcvduetfsmlnkojpiqhrg"];
const bags: Bag[] = [{}, {}, {}, {}];
const boxes: Box[] = [{}, {}, {}];
for (let step = 0; step < letters.length; step++) {
  bags.forEach((bag, index) => {
    bag[orders[index][step] as Name] = step;
  });
  boxes.forEach((box, index) => {
    box[orders[index + 1][step] as Name] = orders[index + 1][step];
  });
  if (step % 5 === 4 || step === letters.length - 1) {
    bags.forEach((bag, index) => console.log("in turns", step, "bag", index, keysOf(bag)));
    boxes.forEach((box, index) => console.log("in turns", step, "box", index, keysOf(box)));
  }
}
console.log("sums", bags.map(bag => Object.values(bag).reduce((sum, value) => sum + value!, 0)).join(" "), boxes.map(box => Object.values(box).join("")).join(" "));

for (const names of ["qr", "qrst", "qrstuvwx", "qrsx", "qrstuvwa", "q", "", "qrstuvwxabcdefghijklmnop", "qrstuvwxabcdefghijklmnpo", "rq", "qrstuvwxab"])
  console.log("whole", names || "-", keysOf(bagOf(names)), keysOf(copyOf(bagOf(names))), keysOf(add(copyOf(bagOf(names)), "jk")));

function literals(): Bag[] {
  return [{ a: 1, b: 2, c: 3 }, { a: 1, b: 2, d: 4 }, { a: 1, b: 2, d: 4, c: 3 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1 }, {}];
}
for (const late of ["c", "d", "dc", "cd", "e", "ba", "xd", "dce", "ced"]) {
  console.log("leaves its order with", late, literals().map(bag => {
    for (const name of late) {
      if (!(name in bag))
        bag[name as Name] = 9;
    }
    return keysOf(bag);
  }).join(" "));
}

let asCreated = 0;
let created = 0;
for (let rotation = 0; rotation < letters.length; rotation++) {
  const rotated = letters.slice(rotation) + letters.slice(0, rotation);
  for (let swapped = 0; swapped + 1 < letters.length; swapped += 2) {
    const names = rotated.slice(0, swapped) + rotated[swapped + 1] + rotated[swapped] + rotated.slice(swapped + 2);
    for (const bag of [add({}, names), copyOf(bagOf(names)), add(copyOf(bagOf(names.slice(0, swapped))), names.slice(swapped))]) {
      created++;
      if (keysOf(bag) === names)
        asCreated++;
    }
  }
}
console.log("rotated and swapped", asCreated, "of", created);

function withOutsiders(steps: string): Bag {
  const bag: Bag = { a: 1 };
  for (const step of steps) {
    if (step >= "A" && step <= "Z")
      (bag as any)["outside" + step] = step;
    else
      bag[step as Name] = 2;
  }
  return bag;
}
function listed(object: object): string {
  const byForIn: string[] = [];
  for (const key in object) byForIn.push(key);
  const keys = Object.keys(object).join(",");
  return keys === byForIn.join(",") && keys === Reflect.ownKeys(object).join(",") && keys === Object.keys({ ...object }).join(",") ? keys : "the ways differ";
}
for (const steps of ["AbBc", "AbBc", "AbcB", "ABbc", "bAcB", "bcAB", "AbBcCdDe", "AbBcCdDf", "ABCDb", "ABCDb", "ABCDEb", "bABCDcEFd"])
  console.log("with keys from outside", steps, listed(withOutsiders(steps)));

const emptied = add({}, "hgfedcba");
for (const name of "geca") delete emptied[name as Name];
console.log("after deletes", keysOf(emptied), keysOf(add(emptied, "aceg")), keysOf(add(copyOf(emptied), "ijkl")));
