const lines: string[] = [];
const none: number = Date.now() < 99 ? 1 : 0;
function say(...parts: unknown[]): void {
  lines.push(parts.join(" "));
}
const readers: (() => unknown)[] = [];
function tell(): void {
  say("told", readers.map(read => read()).join());
}
function fail(really: boolean): void {
  if (really) throw new Error("failed");
}
function orNothing(value: number): number | undefined {
  return value % 3 === 1 ? undefined : value;
}
function eitherKind(value: number): number | string {
  return value % 3 === 1 ? "s" + value : value;
}
let held1: { value: number } = { value: 1 }; readers.push(() => held1.value);

{
  const seed: number = 1;
  const told = readers.length;
  const box2: { held: bigint } = { held: BigInt(seed) };
  var held3: number = seed;
  readers.push(() => held3);
  function poke2(by: number): void { box2.held = box2.held * 3n + BigInt(by); }
const proxy2 = new Proxy({} as Record<string, number>, { get(): number { poke2(3); return 3; }, has(): boolean { poke2(4); return true; } });
function withDefault2(by: number = (poke2(5), 5)): number { return by; }
  {
  const left: (() => unknown)[] = [];
  for (let around = 0; around < 2; around++) {
  const box4: { held: string } = { held: "t" + around }; 
  function poke4(by: number): void { box4.held = (box4.held + by).slice(-9); }
class Checker4 { static [Symbol.hasInstance](value: unknown): boolean { poke4(1); return false; } }
  {
    let seen = "", sum = 0;
    tell();
    try {
    let at = 0;
    do {
      box4.held = (box4.held + at).slice(-9);
      if (box4.held.length > 40) break;
      if (at === 1) seen += "," + box4.held;
      seen += "," + String(box2.held); sum += new Int32Array([2, 1]).sort((x, y) => (poke4(1), x - y))[0]; seen += "/" + String(box2.held);
      box4.held = (box4.held + at).slice(-9); seen += ({}) instanceof Checker4; seen += "," + box4.held;
      if (at === 1) continue;
    } while (++at < 4 + none);
    } finally {
      say("finally", box4.held, String(box2.held));
    }
    say("loop 1.1", seen, sum, box4.held, String(box2.held));
  }
  left.push(() => box4.held);
  }
  say("left", left.map(each => each()).join());
  }
  tell();
  {
  const work = (turns: number): void => {
    let seen = "", sum = 0;
    try {
    for (let at = 0; Number(box2.held % 7n) < 9 && at < 9; at++) {
      try { if (at === 0) break; } finally { box2.held = box2.held * 3n + BigInt(at); }
      { const before = box2.held; if (at === 3) sum += withDefault2(); seen += before === box2.held ? "=" : "!"; }
      sum += Number(box2.held % 7n);
      try { fail(at === 0); box2.held = box2.held * 3n + BigInt(at); } catch { seen += "," + String(box2.held); }
      seen += "," + String(box2.held); seen += "k" in proxy2; box2.held = box2.held * 3n + BigInt(at);
    }
    } finally {
      say("finally", String(box2.held), held1.value);
    }
    say("loop 1.2", seen, sum, String(box2.held), held1.value);
  };
  work(2 + none);
  }
  tell();
  say("end 1", held1.value, String(box2.held), held3);
  readers.length = told;
}
{
  const seed: number = 1;
  const told = readers.length;
  var held5: string = "t" + seed;
  readers.push(() => held5);
  function poke5(by: number): void { held5 = (held5 + by).slice(-9); }
function far5(by: number): void { if (by > 90) far5(by - 90); else poke5(by); }
  {
  const left: (() => unknown)[] = [];
  for (let around = 0; around < 2; around++) {
  let held6: number = around + 0.5; readers.push(() => held6);
  
  {
  const work = (turns: number): void => {
    let seen = "", sum = 0;
    tell();
    for (let at = 0; held6 < 3 && at < 9; at++) {
      held6 = held6 * 1.5 + at;
      sum += held6;  sum += held6;
    }
    say("loop 2.1", seen, sum, held6, held5);
  };
  work(2 + none);
  }
  left.push(() => held6);
  }
  say("left", left.map(each => each()).join());
  }
  {
  function work(turns: number): void {
    let seen = "", sum = 0;
    tell();
    for (let at = 0; held5.length < 30 && at < 9; at++) {
      seen += "," + held5;
      sum += held5.length;  sum += held5.length;
      held5 ||= "e";
      if (at === 3) { far5(at); }
      sum += held5.length;
    }
    say("loop 2.2", seen, sum, held5);
  }
  work(5);
  }
  {
    let seen = "", sum = 0;
    for (let at = 0; ; ) {
      seen += "," + held1.value;
      seen += "," + held1.value + "/" + held1.value;
      if (at !== 1) held5 ||= "e";
      if (++at >= 3 + none) break;
    }
    say("loop 2.3", seen, sum, held1.value, held5);
  }
  tell();
  say("end 2", held1.value, held5);
  readers.length = told;
}
tell();
console.log(lines.join("\n"));

export {};
