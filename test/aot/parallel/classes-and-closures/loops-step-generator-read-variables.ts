// Loops of several forms run in closures and in the bodies of functions. They read variables and fields of enclosing code that inner functions, getters, setters and a generator stepped in the loop change,
// and say after each turn whether what they read before is still what is there.
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
const box1: { held: bigint } = { held: BigInt(1) };
function poke1(by: number): void {
  box1.held = box1.held * 3n + BigInt(by);
}
function peek1(): void {
  say("peek", String(box1.held));
}
const probe1 = {
  get now(): number {
    poke1(1);
    return 1;
  },
  set now(by: number) {
    poke1(by);
  },
};
function scene1(seed: number): void {
  const told = readers.length;
  let held2: number = seed;
  readers.push(() => held2);
  function poke2(by: number): void {
    held2 = held2 + by + 1;
  }
  const probe2 = {
    get now(): number {
      poke2(1);
      return 1;
    },
    set now(by: number) {
      poke2(by);
    },
  };
  {
    const work = (
      () =>
      (turns: number): void => {
        let seen = "",
          sum = 0;
        for (let at = 0; at < turns; at++) {
          {
            const before = held2;
            sum += { ...probe2 }.now;
            seen += before === held2 ? "=" : "!";
          }
          seen += "," + held2;
        }
        say("loop 1.1", seen, sum, held2);
      }
    )();
    work(2 + none);
  }
  tell();
  {
    let seen = "",
      sum = 0;
    for (let at = 4 - 1; at >= 0; at--) {
      box1.held = box1.held * 3n + BigInt(at);
      box1.held++;
      sum += Object.values(probe1)[0];
      sum += Number(box1.held % 7n);
      if (at === 0) {
        box1.held = box1.held * 3n + BigInt(at);
        continue;
      }
      try {
        box1.held = box1.held * 3n + BigInt(at);
        fail(at === 0);
        box1.held = box1.held * 3n + BigInt(at);
      } catch {
        seen += "," + String(box1.held);
      } finally {
        sum += Number(box1.held % 7n);
      }
      if (Number(box1.held % 7n) > 40) break;
      sum += Number(box1.held % 7n) + (poke1(at), Number(box1.held % 7n));
    }
    say("loop 1.2", seen, sum, String(box1.held), held2);
  }
  {
    const left: (() => unknown)[] = [];
    for (let around = 0; around < 2; around++) {
      const box3: { held: number } = { held: around };
      readers.push(() => box3.held);
      function poke3(by: number): void {
        box3.held = box3.held + by + 1;
      }
      const probe3 = {
        get now(): number {
          poke3(1);
          return 1;
        },
        set now(by: number) {
          poke3(by);
        },
      };
      const stepper3 = (function* (): Generator<number, void, unknown> {
        for (let step = 0; ; step++) {
          poke3(step);
          yield step;
        }
      })();
      {
        const work = (turns: number): void => {
          let seen = "",
            sum = 0;
          let at = 0;
          do {
            box3.held = box3.held + at + 1;
            seen += "," + box3.held;
            sum += box3.held;
            sum += Object.values(probe3)[0];
            sum += box3.held;
            box3.held &&= box3.held + at;
            stepper3.next();
            if (at === 0) break;
          } while (++at < turns);
          say("loop 1.3", seen, sum, box3.held, held2);
        };
        work(2);
        work(0 + none);
      }
      left.push(() => box3.held);
    }
    say("left", left.map(each => each()).join());
  }
  say("end 1", String(box1.held), held2);
  readers.length = told;
}
scene1(1);
function scene2(seed: number): void {
  box1.held = BigInt(seed);
  const told = readers.length;
  const box4: { held: number } = { held: 2147483644 + seed };
  readers.push(() => box4.held);
  function poke4(by: number): void {
    box4.held = box4.held + 1 + (by % 2);
  }
  {
    const left: (() => unknown)[] = [];
    for (let around = 0; around < 3; around++) {
      const box5: { held: number | string } = { held: eitherKind(around) };
      readers.push(() => String(box5.held));

      {
        let seen = "",
          sum = 0;
        tell();
        let at = -1;
        while (++at < 5 + none) {
          if (at === 0) continue;
        }
        say("loop 2.1", seen, sum, String(box5.held), box4.held);
      }
      left.push(() => String(box5.held));
    }
    say("left", left.map(each => each()).join());
  }
  tell();
  {
    let seen = "",
      sum = 0;
    for (let at = 0, first = (): number => at; at < 2; at++) {
      sum += first();
      if (at % 4 === 3) {
        if (at === 0) poke1(at);
      }
      sum += Number(box1.held % 7n);
      {
        const before = box1.held;
        seen += before === box1.held ? "=" : "!";
      }
      seen += "," + String(box1.held) + "/" + String(box1.held);
    }
    say("loop 2.2", seen, sum, String(box1.held), box4.held);
  }
  tell();
  {
    function work(turns: number): void {
      let seen = "",
        sum = 0;
      tell();
      let at = 0;
      do {
        seen += [3, 1, 2].sort((x, y) => (poke4(1), x - y))[0];
        box1.held = box1.held * 3n + BigInt(at);
        sum += Number(box1.held % 7n);
        for (let inner = 0; inner < 2; inner++) {
          box1.held += 2n;
          sum += Number(box1.held % 7n);
        }
      } while (++at < turns);
      say("loop 2.3", seen, sum, String(box1.held), box4.held);
    }
    work(4 + none);
    peek1();
    work(1);
  }
  tell();
  say("end 2", String(box1.held), box4.held);
  readers.length = told;
}
scene2(1);
tell();
console.log(lines.join("\n"));

export {};
