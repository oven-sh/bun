// The members of a literal are functions, and between them stands a member whose value takes a branch, a call that may throw, or a loop. Whatever the compiler does with the arms, each object has its own function objects.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
interface Handlers {
  name: string;
  open(): string;
  mode: string | number;
  close(): string;
  retry: (() => string) | undefined;
  count: number;
  last(): string;
}
let made = 0;
function handlers(name: string, flag: unknown): Handlers {
  return {
    name,
    open: () => "open",
    mode: typeof flag === "string" ? flag + "!" : typeof flag === "number" ? flag + 1 : "none",
    close: () => "close",
    retry: flag ? () => "retry" : undefined,
    count: ++made,
    last: function () {
      return "last";
    },
  };
}
function describe(one: Handlers) {
  return [one.name, one.open(), one.mode, one.close(), one.retry?.(), one.count, one.last()].join(" | ");
}
const kept: Handlers[] = [];
for (let i = 0; i < 300; i++) kept.push(handlers("h" + i, i % 3 === 0 ? "s" + i : i % 3 === 1 ? i : i % 2 ? null : undefined));
say(describe(kept[0]), describe(kept[1]), describe(kept[2]), describe(kept[299]));
say(kept[0].open === kept[0].open, kept[0].open !== kept[1].open, kept[3].close !== kept[6].close, kept[4].last !== kept[7].last, kept[0].retry !== kept[3].retry, kept[2].retry === kept[5].retry);

// The same function object whoever reads it first, by name or by type.
const loose = kept[10] as unknown as Record<string, () => string>;
const byName = loose["clo" + "se"];
say(byName === kept[10].close, byName(), Object.keys(kept[10]).join());

// Arms that give different functions, and an arm that gives a function made before.
const shared = () => "shared";
function choose(n: number) {
  return {
    pick: n % 2 ? () => "odd" : () => "even",
    same: n % 3 ? shared : () => "own",
    n,
  };
}
const chosen = [0, 1, 2, 3, 4, 5, 6].map(choose);
say(chosen.map(one => one.pick() + one.same() + one.n).join(), chosen[1].same === chosen[2].same, chosen[0].same !== chosen[3].same, chosen[1].pick !== chosen[3].pick);

// A loop whose every round makes the closure anew, and a literal behind it that takes the last one.
function lastOf(rounds: number) {
  let run = () => "none";
  for (let i = 0; i < rounds; i++) run = () => "round";
  return { run, rounds };
}
say(lastOf(0).run(), lastOf(3).run(), lastOf(2).run !== lastOf(2).run);

// A member that throws between the functions.
function fails(n: number) {
  return {
    before: () => "before",
    value: n > 1 ? JSON.parse("{") : n,
    after: () => "after",
  };
}
for (const n of [0, 1, 2]) {
  try {
    const one = fails(n);
    say(one.before(), one.value, one.after());
  } catch (error) {
    say((error as Error).constructor.name);
  }
}
console.log(lines.join("\n"));
