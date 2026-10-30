// Objects that nothing holds but a function that waits: many async functions and async generators in flight at once, each with fresh objects alive across its awaits, while others allocate.
//
//   held      objects of a class, with references to one another, arrays of them, arrays of numbers, fresh strings, closures, Maps, `T | null`; made in front of an await and read behind it
//   dead      objects that are read for the last time in front of an await; variables that only one path assigns and only that path reads, with awaits between
//   waits     on nothing, on a settled promise, on an async function, on a microtask, on a timer of 0 to 30 ms, on setImmediate, on a message through a MessageChannel, on a promise that another task or another thread settles later
//   flow      awaits in loops, in both arms of an if, in try, catch and finally, behind a rejection; for await over an async generator that is also left early
//   at once   8 to 120 tasks of two to four kinds, started together; a task may start tasks of its own
//   garbage   every task throws away objects between its waits, so that collections come while the others are suspended
//
// Each task folds what it held into a number; the program prints one line for each kind of task. Always TypeScript: the mode `erased` gives the untyped form.
import type { Random } from "./random";

const prelude = `declare function setImmediate(callback: () => void): unknown;
class Item {
  next: Item | null = null;
  tags: string[] = [];
  constructor(
    public n: number,
    public label: string,
    public ratio: number,
  ) {}
}
let made = 0;
function fresh(n: number): Item {
  made++;
  const item = new Item(n | 0, "i" + (n & 63), n * 0.5);
  if (n & 1) item.next = new Item((n + 1) | 0, "n" + (n & 7), n * 0.25);
  if (n & 2) item.tags.push("t" + (n & 15), "u");
  return item;
}
function seen(item: Item | null): number {
  if (item === null) return 11;
  return (item.n ^ item.label.length ^ ((item.ratio * 4) | 0) ^ (item.next === null ? 3 : item.next.n * 31 + item.next.label.length) ^ (item.tags.length * 7 + (item.tags.length ? item.tags[0].length : 0))) | 0;
}
function churn(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const gone = fresh(i);
    const list = [gone, fresh(i + 1), gone.next];
    sum = (sum + seen(list[i % 3]) + ("g" + i).length) | 0;
  }
  return sum;
}
async function later(x: number): Promise<number> {
  return (x + 1) | 0;
}
async function laterItem(x: number): Promise<Item> {
  await null;
  return fresh(x);
}
async function refuses(x: number): Promise<number> {
  await null;
  throw fresh(x);
}
function timer(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function immediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
function microtask(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}
function message(x: number): Promise<number> {
  return new Promise(resolve => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = event => {
      port1.close();
      port2.close();
      resolve(event.data as number);
    };
    port2.postMessage(x);
  });
}
const gates: ((value: number) => void)[] = [];
function gate(): Promise<number> {
  return new Promise(resolve => gates.push(resolve));
}
function open(value: number): void {
  const resolve = gates.shift();
  if (resolve) resolve(value);
}
// Where several threads run this program, each also opens the gates of the others.
const others = new BroadcastChannel("objects-across-awaits");
others.onmessage = () => open(0);
function shout(): void {
  others.postMessage(1);
}
async function* stream(count: number, from: number): AsyncGenerator<Item, number, unknown> {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const item = fresh(from + i);
    if (i & 1) await null;
    yield item;
    sum = (sum + seen(item)) | 0;
  }
  return sum;
}
`;

export function generate(random: Random): string {
  const below = (limit: number) => random.below(limit);
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude];
  const kinds = random.between(2, 4);
  const notes: string[] = [];

  for (let kind = 0; kind < kinds; kind++) {
    let names = 0;
    let budget = random.pick([12, 25, 50, 90]);
    // What is alive: name and how it folds into a number.
    const held: { name: string; fold: string; type: string; make: () => string }[] = [];
    const number = () => pick(["k", "sum", "(k + sum)", `${below(50)}`, "(sum & 255)"]);
    const makers: [string, (name: string) => string, () => string][] = [
      ["Item", name => `seen(${name})`, () => pick([`fresh(${number()})`, `fresh(${number()})`, `new Item(${number()}, "x", 0.5)`, `await laterItem(${number()})`])],
      ["Item | null", name => `seen(${name})`, () => pick([`sum & 1 ? fresh(${number()}) : null`, `fresh(${number()}).next`, `(null as Item | null)`])],
      ["Item[]", name => `(${name}.length * 3 + seen(${name}[${name}.length - 1]))`, () => `[fresh(${number()}), fresh(${number()} + 1)${below(2) ? `, fresh(${below(9)})` : ""}]`],
      ["number[]", name => `(${name}[0] + ${name}.length + ((${name}[1] * 2) | 0))`, () => `[${number()}, ${number()} * 0.5, ${below(9)}]`],
      ["string", name => `(${name}.length * 31 + ${name}.charCodeAt(0))`, () => `"s" + ${number()} + "-" + (sum & 7)`],
      ["() => number", name => `${name}()`, () => `(held => () => seen(held) + 1)(fresh(${number()}))`],
      ["Map<number, Item>", name => `(${name}.size + seen(${name}.get(1) ?? null))`, () => `new Map([[1, fresh(${number()})], [2, fresh(${below(9)})]])`],
      ["{ a: Item; b: number }", name => `(seen(${name}.a) + ((${name}.b * 2) | 0))`, () => `{ a: fresh(${number()}), b: ${number()} * 0.5 }`],
    ];
    const wait = () =>
      pick(["await null;", "await null;", `sum = (sum + (await later(${number()}))) | 0;`, "await microtask();", "await microtask();", `await timer(${pick([0, 1, 1, 2, 2, 5, 12, 30])});`, "await immediate();", `shout(); await Promise.race([gate(), timer(${pick([1, 3, 10])})]);`, `sum = (sum + (await message(${number()}))) | 0;`, `await Promise.resolve(${number()});`,
        `sum = (sum + (await Promise.all([later(${number()}), later(sum)]))[1]) | 0;`, "open(1); await Promise.race([gate(), timer(1)]);"]); // prettier-ignore
    const declare = () => {
      const [type, fold, make] = pick(makers);
      const name = "h" + names++;
      held.push({ name, fold: fold(name), type, make });
      return `let ${name}: ${type} = ${make()};`;
    };
    const use = () => (held.length ? `sum = (sum + ${pick(held).fold}) | 0;` : "sum = (sum + 1) | 0;");
    const renew = () => {
      if (!held.length) return declare();
      const one = pick(held);
      return `${one.name} = ${one.make()};`;
    };
    const statements = (left: number, scope: number): string => {
      let all = "";
      for (let more = 2 + below(4); more-- && budget > 0; ) {
        budget--;
        const inner = () => {
          const before = held.length;
          const block = statements(left - 1, before);
          held.length = before;
          return block;
        };
        switch (left > 0 ? below(20) : below(9)) {
          case 0: case 1: all += declare(); break; // prettier-ignore
          case 2: case 3: all += wait(); break; // prettier-ignore
          case 4: all += use(); break; // prettier-ignore
          case 5: all += renew(); break; // prettier-ignore
          case 6: all += `sum = (sum + churn(${pick([1, 3, 10, 40])})) | 0;`; break; // prettier-ignore
          // Read for the last time in front of a wait.
          case 7: all += `{ const gone = fresh(${number()}); sum = (sum + seen(gone)) | 0; } ${wait()}`; break; // prettier-ignore
          case 8: all += `${declare()}${wait()}${use()}`; break; // prettier-ignore
          case 9: case 10: all += `for (let c${names} = 0; c${names} < ${2 + below(4)}; c${names++}++) {${inner()}${wait()}${use()}}`; break; // prettier-ignore
          case 11: all += `if (${pick(["sum & 1", "k & 1", "sum > k", "(k + sum) % 3 === 0"])}) {${inner()}${wait()}} else {${inner()}}`; break; // prettier-ignore
          case 12: {
            // Only one path assigns it, and only that path reads it, with waits between.
            const [name, test] = ["p" + names++, pick(["(k & 1) === 0", "k % 3 === 1", "(k & 4) !== 0"])];
            all += `let ${name}: Item | null = null; if (${test}) ${name} = fresh(${number()}); ${wait()}${inner()}${wait()} if (${test}) sum = (sum + seen(${name})) | 0;`;
            break;
          }
          case 13: all += `try {${inner()} sum = (sum + (await refuses(${number()}))) | 0;} catch (thrown) { ${wait()} sum = (sum + seen(thrown as Item)) | 0;${use()}} finally {${wait()}${use()}}`; break; // prettier-ignore
          case 14: all += `try {${inner()}${wait()}} finally {${use()}${wait()}${use()}}`; break; // prettier-ignore
          case 15: all += `for await (const item of stream(${1 + below(5)}, ${number()})) {${below(2) ? wait() : ""} sum = (sum + seen(item)) | 0;${use()}${below(3) ? "" : "if (sum & 1) break;"}}`; break; // prettier-ignore
          case 16: all += `{ const chain = fresh(${number()}); let last = chain; for (let c${names} = 0; c${names} < ${2 + below(5)}; c${names++}++) { last.next = fresh(sum + 1); last = last.next; ${wait()} } sum = (sum + seen(chain) + seen(last)) | 0; }`; break; // prettier-ignore
          case 17: all += kind > 0 && scope >= 0 && !below(3) ? `if (k < 4) sum = (sum + (await task${below(kind)}(k + 100))) | 0;` : use(); break; // prettier-ignore
          case 18: all += `sum = (sum + (await Promise.all([${declareInline()}, ${declareInline()}].map(async (item, at) => { ${pick(["await null;", "await microtask();", "await timer(1);", "await immediate();", "await message(at);"])} return seen(item) + at; }))).reduce((a, b) => (a + b) | 0, 0)) | 0;`; break; // prettier-ignore
          default: all += `${use()}${wait()}`; // prettier-ignore
        }
      }
      return all;
    };
    function declareInline(): string {
      return `fresh(${number()})`;
    }
    const body = statements(random.between(2, 3), 0);
    const tasks = random.pick([8, 20, 50, 120]);
    notes.push(`${tasks} of ${body.length} characters`);
    text.push(`async function task${kind}(k: number): Promise<number> {
  let sum = k | 0;
  ${body.replace(/([;{}])(?=[^\n])/g, "$1\n")}
  return (sum${held.map(each => ` + ${each.fold}`).join("")}) | 0;
}`);
    text.push(`const started${kind} = Array.from({ length: ${tasks} }, (_, k) => task${kind}(k));`);
  }
  text.push(`{
  const stop = setInterval(() => open(1), 1);
${Array.from({ length: kinds }, (_, kind) => `  console.log("task${kind} " + (await Promise.all(started${kind})).reduce((a, b) => (Math.imul(a, 31) + b) | 0, 0));`).join("\n")}
  clearInterval(stop);
  others.close();
}`);
  return `// ${notes.join(" . ")}\n${text.join("\n")}`;
}
