// Closures made on different turns of loops of every kind each see the variables of their own turn.
function kept<T>(value: T): T {
  return value;
}
function finished<T>(steps: Generator<unknown, T, unknown>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
function read10(each: { read(): number }) {
  return each.read();
}
let kept10: { read(): number } | undefined;
function keeps10(each: { read(): number }) {
  const before = kept10 ?? each;
  kept10 = each;
  return before.read();
}
async function scene0(given: number[]) {
  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    try {
      if (i % 2) continue;
      seen.push(i);
    } finally {
      const ownthing = "ab" + i;
      const thing = new (class {
        kept = ownthing.length;
        read() {
          return this.kept * 2 + ownthing.length;
        }
      })();
      seen.push(Array.from([thing], read10)[0]);
    }
  }
  return seen;
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++)
    said.add(JSON.stringify(await scene0(turn % 7 ? [5, 6, 7] : [turn, 1.5])) ?? "nothing");
  console.log(0, [...said].join(" | "));
}
{
  const given = [5, 6, 7];
  const made: { read(): number }[] = [];
  for (const each of [...given, 9])
    made.push(
      (() => {
        const own = BigInt(Math.trunc(each));
        return new (class {
          kept = Number(own);
          read() {
            return this.kept * 2 + Number(own);
          }
        })();
      })(),
    );
  console.log(
    1,
    JSON.stringify(
      kept(
        made
          .slice()
          .reverse()
          .map(each => Array.from([each], keeps10)[0]),
      ),
    ),
  );
}
function* scene2(given: number[]) {
  const ownthing = new Map([[1, given.length]]);
  const thing = new (class {
    kept = ownthing.get(1)!;
    read() {
      return this.kept * 2 + ownthing.get(1)!;
    }
  })();
  const ownother = new Map([[1, given[0]]]);
  const other = new (class {
    kept = ownother.get(1)!;
    read() {
      return this.kept * 2 + ownother.get(1)!;
    }
  })();
  const seen: number[] = [];
  for (let i = 0; i < 9; i++) {
    const one = i % 2 ? thing : other;
    seen.push([one].map(keeps10)[0]);
  }
  return seen;
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++)
    said.add(JSON.stringify(finished(scene2(turn % 7 ? [5, 6, 7] : [turn, 1.5]))) ?? "nothing");
  console.log(2, [...said].join(" | "));
}
{
  const given = [5, 6, 7];
  const seen: number[] = [];
  for (let i = 0; i < 2; i++) {
    try {
      if (i % 2) continue;
      seen.push(i);
    } finally {
      const thing = new (class {
        kept = i;
        read() {
          return this.kept * 2 + i;
        }
      })();
      seen.push(thing.read());
    }
  }
  console.log(3, JSON.stringify(seen));
}
function scene4(given: number[]) {
  const made: { read(): number }[] = [];
  for (let each of [2, 4, 6, 8, 10, 12, 14, 16, 18]) {
    made.push(
      new (class {
        kept = each;
        read() {
          return this.kept * 2 + each;
        }
      })(),
    );
    each += 1;
  }
  for (let more = 0; more < 2; more++)
    made.push(
      new (class {
        kept = more + 40;
        read() {
          return this.kept * 2 + (more + 40);
        }
      })(),
    );
  const got = made
    .map(each => Array.from([each], keeps10)[0])
    .map(each => ({ read: () => each }))
    .map(each => each.read())
    .filter(each => each > 1)
    .join("-");
  return got;
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++)
    said.add(JSON.stringify(scene4(turn % 7 ? [5, 6, 7] : [turn, 1.5])) ?? "nothing");
  console.log(4, [...said].join(" | "));
}
{
  const given = [5, 6, 7];
  const made: { read(): number }[] = [];
  for (var v = 0; v < 4; v++)
    made.push(
      new (class {
        kept = v;
        read() {
          return this.kept * 2 + v;
        }
      })(),
    );
  const seen: number[] = [];
  for (const each of made) seen.push(Array.from([each], keeps10)[0]);
  console.log(5, JSON.stringify(seen));
}
function* scene6(given: number[]) {
  const made: { read(): number }[] = [];
  for (const each of [[1], [2, 3], [4, 5, 6]])
    made.push(
      new (class {
        kept = each.length;
        read() {
          return this.kept * 2 + each.length;
        }
      })(),
    );
  yield made.length;
  const seen: number[] = [];
  let next = 0;
  while (next < made.length) seen.push(made[next++].read());
  return seen;
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++)
    said.add(JSON.stringify(finished(scene6(turn % 7 ? [5, 6, 7] : [turn, 1.5]))) ?? "nothing");
  console.log(6, [...said].join(" | "));
}
function scene7(given: number[]) {
  const made: { read(): number }[] = [];
  for (let i = 0; i < 9; i++) {
    const mine = String(i);
    made.push(
      new (class {
        kept = mine.length;
        read() {
          return this.kept * 2 + mine.length;
        }
      })(),
    );
  }
  for (let more = 0; more < 3; more++)
    made.splice(
      more,
      0,
      new (class {
        kept = more * 7;
        read() {
          return this.kept * 2 + more * 7;
        }
      })(),
    );
  return made
    .slice(1)
    .filter((_, at) => at % 2 === 0)
    .map(each => Array.from([each], keeps10)[0])
    .filter(each => each > 1)
    .map(each => each * 2)
    .join("-");
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++)
    said.add(JSON.stringify(scene7(turn % 7 ? [5, 6, 7] : [turn, 1.5])) ?? "nothing");
  console.log(7, [...said].join(" | "));
}
class Holder8 {
  run(given: number[]) {
    const made = [2, 4, 6, 8, 10, 12, 14, 16, 18].map(each =>
      (() => {
        const own = "ab" + each;
        return new (class {
          kept = own.length;
          read() {
            return this.kept * 2 + own.length;
          }
        })();
      })(),
    );
    made.unshift(
      new (class {
        kept = given.length + 0.5;
        read() {
          return this.kept * 2 + given.length + 0.5;
        }
      })(),
    );
    const seen: number[] = [];
    for (const each of made) for (let twice = 0; twice < 2; twice++) seen.push(Array.from([each], keeps10)[0]);
    return seen;
  }
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++)
    said.add(JSON.stringify(new Holder8().run(turn % 7 ? [5, 6, 7] : [turn, 1.5])) ?? "nothing");
  console.log(8, [...said].join(" | "));
}
export {};
