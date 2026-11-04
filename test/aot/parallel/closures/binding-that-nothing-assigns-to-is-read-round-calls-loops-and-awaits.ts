// A `const`, a `let` that nothing assigns again and a declared function hold one value from their declaration on. Reads stand round calls, in loops and round awaits, in front of the declaration too.
const log: string[] = [];
function early(): string { try { return String(settings.depth); } catch (error) { return (error as Error).name; } }
log.push(early());
const settings = { depth: 2 };
let once = log.length;
function touch() { settings.depth++; return settings; }
function readRoundCalls(): string { const a = settings.depth; const same = touch() === settings; const b = settings.depth; return a + ":" + b + ":" + same + ":" + once; }
log.push(early(), readRoundCalls(), readRoundCalls());

function scope(start: number) {
  const list: number[] = [start];
  let fixed = start * 2;
  let moving = 0;
  const grow = () => { list.push(list.length + fixed); moving++; };
  const sum = () => { let total = 0; for (let i = 0; i < 3; i++) { grow(); total += list.length + moving + fixed; } return total; };
  const peek = () => { try { return tail.length; } catch (error) { return (error as Error).name; } };
  const first = peek();
  const tail = [first];
  return [sum(), sum(), list.join(), peek(), moving].join("|");
}
log.push(scope(1), scope(5));

const perTurn: Array<() => number> = [];
for (const value of [3, 4, 5]) { const doubled = value * 2; perTurn.push(() => doubled + value); }
log.push(perTurn.map(f => f() + f()).join());

async function roundAwaits(): Promise<string> {
  const held = { n: 1 };
  const read = async () => { const a = held.n; await null; const b = held.n; return a + ":" + b + ":" + settings.depth; };
  const pending = read();
  held.n = 7;
  touch();
  return (await pending) + "|" + (await read());
}
log.push(await roundAwaits());

function* stepwise() { const kept = { n: 0 }; const bump = () => ++kept.n; yield bump(); yield bump() + kept.n; yield kept.n; }
log.push([...stepwise()].join());

switch (log.length) { default: { const inCase = log.length; const f = () => inCase; log.push(String(f() + f())); } }
console.log(log.join("\n"));
