// A guess fails in the body of an async function while more is alive than registers of any kind take: objects, numbers with and without a fraction, a boolean, texts, a list, undefined, and an object that nobody has built yet.
// It fails in front of the first await, between two awaits, behind the last, in front of a loop and in a turn. Each value is read again behind the place where the guess fails, so the answer shows all of them.
// The collector runs while the function waits, and nothing but the frame that waits holds the values. Two calls are under way at a time, so a guess of one fails while the other waits.
// Each answer is worked out a second time without a coroutine, and the first that differs ends the run with an error.
function openTheWorld(): unknown { return eval("1"); }
type Item = { price: number; name: string };

function collect(): void {
  const bun = (globalThis as any).Bun;
  if (bun && typeof bun.gc === "function") bun.gc(true);
}

let pauses = 0;
async function pause(): Promise<void> {
  await null;
  if (++pauses % 16 === 0) collect();
}

export async function wide(a: Item, b: Item, c: Item, d: Item, e: Item, f: Item, g: Item, h: Item, i: Item, j: Item, n0: number, n1: number, n2: number, flag: boolean, text: string, list: number[], maybe: Item | undefined, wait: () => Promise<void>): Promise<string> {
  let sum = a.price + b.price;
  await null;
  const half = n0 / 2;
  const whole = (n1 | 0) + 1;
  const made = { price: n2 + half, name: text + whole };
  sum += c.price;
  sum += d.price;
  await wait();
  sum += e.price;
  sum += f.price;
  sum += g.price;
  await wait();
  sum += h.price;
  sum += i.price;
  sum += j.price;
  const rest = maybe === undefined ? "none" : maybe.name;
  return a.name + b.name + c.name + d.name + e.name + f.name + g.name + h.name + i.name + j.name + ":" + sum + ":" + half + ":" + whole + ":" + made.price + made.name + ":" + flag + ":" + text + ":" + list.length + ":" + list[0] + ":" + rest + ":" + n0 + n1 + n2;
}

function wideAgain(items: any[], n0: any, n1: any, n2: any, flag: any, text: any, list: any, maybe: any): string {
  const half = n0 / 2;
  const whole = (n1 | 0) + 1;
  let sum: any = items[0].price + items[1].price;
  for (let k = 2; k < 10; k++) sum += items[k].price;
  let names = "";
  for (let k = 0; k < 10; k++) names += items[k].name;
  return names + ":" + sum + ":" + half + ":" + whole + ":" + (n2 + half) + (text + whole) + ":" + flag + ":" + text + ":" + list.length + ":" + list[0] + ":" + (maybe === undefined ? "none" : maybe.name) + ":" + n0 + n1 + n2;
}

export async function turns(items: Item[], a: Item, b: Item, c: Item, d: Item, e: Item, f: Item, g: Item, h: Item, scale: number, offset: number, label: string, wait: () => Promise<void>): Promise<string> {
  await null;
  let sum = offset;
  let names = label;
  for (let k = 0; k < items.length; k++) {
    sum += items[k].price + scale;
    names += items[k].name;
  }
  await wait();
  return names + a.name + b.name + c.name + d.name + e.name + f.name + g.name + h.name + ":" + sum + ":" + (a.price + h.price) + ":" + scale + ":" + offset;
}

function turnsAgain(items: any[], around: any[], scale: any, offset: any, label: any): string {
  let sum: any = offset;
  let names = label;
  for (let k = 0; k < items.length; k++) {
    sum += items[k].price + scale;
    names += items[k].name;
  }
  for (let k = 0; k < 8; k++) names += around[k].name;
  return names + ":" + sum + ":" + (around[0].price + around[7].price) + ":" + scale + ":" + offset;
}

function fresh(k: number, wrong: number, round: number): Item {
  return { price: (k === wrong ? "<" + k + ">" : k + 1) as any, name: String.fromCharCode(97 + k) + (round & 3) };
}

function row(count: number, wrong: number, round: number): Item[] {
  const items: Item[] = [];
  for (let k = 0; k < count; k++) items.push(fresh(k, wrong, round));
  return items;
}

async function main() {
  (globalThis as any).wide = wide;
  (globalThis as any).turns = turns;
  openTheWorld();
  const seen = new Set<string>();
  let length = 0;
  for (let round = 0; round < 396; round++) {
    const wrongs = [round % 33 < 10 ? round % 33 : -1, (round * 7) % 33 < 10 ? (round * 7) % 33 : -1];
    const callWide = (wrong: number) => {
      const x = row(10, wrong, round);
      return wide(x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], x[9], round + 0.5, round, round & 7, (round & 1) === 0, "t" + round, [round, 1, 2], round & 2 ? fresh(3, wrong, round) : undefined, pause);
    };
    const callTurns = (wrong: number) => {
      const x = row(8, wrong < 8 ? -1 : 0, round);
      return turns(row(6, wrong, round), x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], round & 3, round & 1, "=", pause);
    };
    const answers = await Promise.all([callWide(wrongs[0]), callWide(wrongs[1]), callTurns(wrongs[0]), callTurns(wrongs[1])]);
    for (let which = 0; which < 2; which++) {
      const wrong = wrongs[which];
      const again = wideAgain(row(10, wrong, round), round + 0.5, round, round & 7, (round & 1) === 0, "t" + round, [round, 1, 2], round & 2 ? fresh(3, wrong, round) : undefined);
      if (answers[which] !== again) throw new Error("wide, round " + round + ", wrong " + wrong + ": " + answers[which] + " | " + again);
      const turnedAgain = turnsAgain(row(6, wrong, round), row(8, wrong < 8 ? -1 : 0, round), round & 3, round & 1, "=");
      if (answers[2 + which] !== turnedAgain) throw new Error("turns, round " + round + ", wrong " + wrong + ": " + answers[2 + which] + " | " + turnedAgain);
    }
    for (const answer of answers) {
      length += answer.length;
      if (round < 66) seen.add(answer);
    }
  }
  console.log(length, seen.size, pauses);
  for (const text of [...seen].sort()) console.log(text);
}
main();
