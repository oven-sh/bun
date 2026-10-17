interface Node {
  id: number;
  name: string;
  next: Node | undefined;
  weight: number;
}

let made = 0;
function makeNode(name: string, next: Node | undefined, weight: number): Node {
  made++;
  return { id: made, name, next, weight };
}

function churn(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const list: Node[] = [];
    for (let j = 0; j < 40; j++) list.push(makeNode("churn" + j, undefined, j + 0.5));
    total += list[list.length - 1].id & 7;
  }
  return total;
}

function identityOf(node: Node): number {
  return node.id * 2 + 1;
}

function walk(stack: Node[], depth: number, limit: number, wanted: number, scale: number, label: string): string {
  let count = 0;
  let last = 0.25;
  let seen = "";
  for (let i = 0; i < depth; i++) {
    const node = stack[i];
    const identity = identityOf(node);
    if (identity === wanted) {
      count++;
      if (count >= limit) seen += label + i + ";";
    }
    last = last * scale + node.weight;
    if ((i & 3) === 0) churn(1);
  }
  return seen + count + "/" + last.toFixed(3) + "/" + depth + "/" + limit + "/" + wanted + "/" + label;
}

function anything(index: number): any {
  switch (index % 9) {
    case 0: return index;
    case 1: return index + 0.5;
    case 2: return "s" + index;
    case 3: return undefined;
    case 4: return null;
    case 5: return index % 2 === 0;
    case 6: return { id: index };
    case 7: return -index;
    default: return [index];
  }
}

function describe(value: any): string {
  if (typeof value === "number") return (value | 0) === value ? "int " + value : "double " + value;
  if (typeof value === "string") return "string " + value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean " + value;
  if (Array.isArray(value)) return "array " + value.length;
  return "object " + value.id;
}

function mix(a: any, b: any, c: any, d: any, e: any, f: any): string {
  const first = describe(a);
  const second = describe(b);
  const third = describe(c);
  churn(1);
  const fourth = describe(d);
  const fifth = describe(e);
  const sixth = describe(f);
  return [first, second, third, fourth, fifth, sixth, describe(a), describe(f)].join(",");
}

class Failure extends Error {
  constructor(public code: number) {
    super("failure " + code);
  }
}

function thrower(level: number, code: number): number {
  if (level === 0) throw new Failure(code);
  const a = makeNode("a" + level, undefined, level);
  const b = makeNode("b" + level, a, level + 1);
  const c = level * 3;
  const result = thrower(level - 1, code + 1);
  return result + a.id + b.id + c;
}

function catcher(level: number, first: Node, second: Node, third: number, fourth: string, fifth: number): string {
  let out = "";
  for (let round = 0; round < 3; round++) {
    try {
      out += thrower(level + round, round * 10);
    } catch (error) {
      out += (error as Failure).code + ":" + first.name + second.name + third + fourth + fifth.toFixed(2) + ";";
    } finally {
      out += first.id - second.id;
    }
  }
  return out;
}

function throughNatives(values: number[], base: Node, factor: number, label: string): string {
  let out = "";
  const mapped = values.map((value, index) => value * factor + base.id + index);
  out += mapped.join(",") + label;
  const sorted = values.slice().sort((left, right) => (right - left) * factor);
  out += sorted.join(",") + base.name;
  try {
    values.forEach(value => {
      if (value === 3) throw new Failure(value * factor);
      out += value;
    });
  } catch (error) {
    out += "caught " + (error as Failure).code + base.name + factor + label;
  }
  const reduced = values.reduce((sum, value) => sum + identityOf(base) * value, 0);
  return out + reduced + base.weight + label;
}

const proxied = new Proxy({ hidden: 5 } as { hidden: number; [key: string]: number }, {
  get(target, key) {
    churn(1);
    return key === "hidden" ? target.hidden : String(key).length;
  },
});

const withAccessors = {
  stored: 1,
  get value(): number {
    churn(1);
    return this.stored * 2;
  },
  set value(next: number) {
    churn(1);
    this.stored = next + 1;
  },
};

function throughForeignCode(a: Node, b: Node, c: number, d: number, e: string): string {
  const first = proxied.hidden + proxied.something;
  withAccessors.value = c;
  const second = withAccessors.value;
  const third = JSON.parse(JSON.stringify({ a: a.id - b.id, c, d, e }));
  const fourth = e.replace(/[aeiou]/g, letter => letter.toUpperCase() + c);
  return [first, second, third.a, third.c, third.d, third.e, fourth, a.name, b.name, c, d, e].join("|");
}

function* produce(from: Node, step: number, label: string, scale: number): Generator<string, number, number> {
  let total = 0;
  let node: Node | undefined = from;
  while (node) {
    const sent: number = yield label + node.name + total;
    total += sent * step + node.weight * scale;
    churn(1);
    node = node.next;
  }
  return total;
}

async function later<T>(value: T): Promise<T> {
  await null;
  return value;
}

async function awaiting(a: Node, b: Node, c: number, d: string, e: number, f: any): Promise<string> {
  let out = "";
  for (let i = 0; i < 4; i++) {
    const got = await later(i + c);
    churn(1);
    out += got + a.name + b.name + d + e.toFixed(1) + describe(f) + ";";
    try {
      await Promise.reject(new Failure(i));
    } catch (error) {
      out += (error as Failure).code + a.name + c;
    }
  }
  return out;
}

function overflow(depth: number, keep: Node): number {
  return overflow(depth + 1, keep) + keep.id;
}

function survivesOverflow(a: Node, b: Node, c: number, d: string): string {
  let caught = "";
  try {
    overflow(0, a);
  } catch (error) {
    caught = (error as Error).constructor.name;
  }
  return caught + a.name + b.name + c + d;
}

function tail(count: number, a: Node, b: number, c: string): string {
  "use strict";
  if (count === 0) return a.name + b + c;
  return tail(count - 1, a, b + 1, c);
}

const nodes: Node[] = [];
let chain: Node | undefined;
for (let i = 0; i < 24; i++) {
  chain = makeNode("n" + i, chain, i * 1.5);
  nodes.push(chain);
}

console.log(walk(nodes, nodes.length, 1, identityOf(nodes[7]), 0.5, "at"));
console.log(walk(nodes, 10, 2, identityOf(nodes[3]), 1.25, "x"));
for (let i = 0; i < 9; i++) console.log(mix(anything(i), anything(i + 1), anything(i + 2), anything(i + 3), anything(i + 4), anything(i + 5)));
console.log(catcher(3, nodes[1], nodes[2], 42, "four", 5.5).replace(/\d{3,}/g, "#"));
console.log(throughNatives([5, 1, 4, 2, 3, 9], nodes[4], 3, "L"));
console.log(throughForeignCode(nodes[5], nodes[9], 7, 8.5, "education"));
const generator = produce(nodes[3], 2, "g", 0.5);
let step = generator.next(0);
let steps = "";
while (!step.done) {
  steps += step.value + ",";
  step = generator.next(steps.length);
}
console.log(steps + step.value);
console.log(survivesOverflow(nodes[6], nodes[8], 11, "deep"));
console.log(tail(100000, nodes[2], 0, "tail"));
awaiting(nodes[10], nodes[11], 3, "d", 2.5, anything(6)).then(result => {
  console.log(result);
  console.log(churn(50) >= 0, made > 0);
});
