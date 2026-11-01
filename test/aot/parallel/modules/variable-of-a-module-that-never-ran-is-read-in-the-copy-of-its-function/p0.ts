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
function scene1(seed: number): void {
  const told = readers.length;
  let held1: string = "t" + seed;
  function poke1(by: number): void { held1 = (held1 + by).slice(-9); }
  {
  const left: (() => unknown)[] = [];
  for (var around = 0; around < 3; around++) {
  var held2: { value: number } = { value: around }; readers.push(() => held2.value);
  function poke2(by: number): void { held2 = { value: held2.value + by + 1 }; }
const proxy2 = new Proxy({} as Record<string, number>, { get(): number { poke2(3); return 3; }, has(): boolean { poke2(4); return true; } });
  {
  function work(turns: number): void {
    let seen = "", sum = 0;
    tell();
    let at = 0;
    do {
      held2 = { value: held2.value + at + 1 };
      held2 = { value: held2.value + at + 1 };
      seen += "k" in proxy2;
    } while (++at < turns);
    say("loop 1.1", seen, sum, held2.value, held1);
  }
  work(2 + none);  work(5 + none);
  }
  left.push(() => held2.value);
  }
  say("left", left.map(each => each()).join());
  }
  tell();
  {
    let seen = "", sum = 0;
    for (const [at, entry] of [0, 1, 2, 3, 4].entries()) {
    }
    say("loop 1.2", seen, sum, held1);
  }
  {
  const work = (() => (turns: number): void => {
    let seen = "", sum = 0;
    tell();
    try {
    let at = 0;
    do {
      fail(at === 3 + 1);
      held1 = (held1 + at).slice(-9);
      [held1 = (held1 + at).slice(-9)] = [undefined];
    } while (++at < turns);
    } catch (error) {
      say("caught", (error as Error).name, held1);
    }
    say("loop 1.3", seen, sum, held1);
  })();
  work(3 + none);  work(4 + none);
  }
  say("end 1", held1);
  readers.length = told;
}
for (let call = 0; call < 3; call++) scene1(call);
function scene2(seed: number): void {
  const told = readers.length;
  var held3: { value: number } = { value: seed };
  let held4: { value: number } = { value: seed };
  {
  function* work(turns: number): Generator<string, void, unknown> {
    let seen = "", sum = 0;
    for (var at = 0; at < turns; at++) {
    }
    say("loop 2.1", seen, sum, held4.value, held3.value);
  }
  for (const step of work(2 + none)) { say("step", step);   }
  }
}

export {};
