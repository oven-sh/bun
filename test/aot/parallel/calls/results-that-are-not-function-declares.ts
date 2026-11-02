// A function declares the type of its result and now and then returns something else: out of `any`, out of a field that somebody overwrote, past the end of a list,
// out of a tail call, through a wrapper, out of a recursion. Whoever called it goes on as plain JavaScript does, whatever it does with the result.
type Point = { x: number; y: number };
type Holder = { value: Point; count: number; ok: boolean; name: string; next: Holder | undefined };

function show(value: unknown): string {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return "{" + Object.keys(value).map(key => key + ": " + show((value as any)[key])).join(", ") + "}";
}

let work = 0;
// Too long to be taken into a caller.
function busy(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum * 31 + i) % 1009;
    if (sum === 7) work++;
  }
  return sum;
}

function valueOf(holder: Holder): Point {
  busy(3);
  return holder.value;
}
function countOf(holder: Holder): number {
  busy(3);
  return holder.count;
}
function isOk(holder: Holder): boolean {
  busy(3);
  return holder.ok;
}
function nameOf(holder: Holder): string {
  busy(3);
  return holder.name;
}
function nextOf(holder: Holder): Holder | undefined {
  busy(3);
  return holder.next;
}
function at(list: Point[], index: number): Point {
  busy(2);
  return list[index];
}

// Tail calls: whoever returns, returns for all three.
function throughThird(holder: Holder): Point {
  busy(1);
  return valueOf(holder);
}
function throughSecond(holder: Holder): Point {
  busy(1);
  return throughThird(holder);
}
function throughFirst(holder: Holder): Point {
  busy(1);
  return throughSecond(holder);
}

// The callee promises less than the caller: a number is a `number | Point`.
function countOrPoint(holder: Holder, wantsCount: boolean): number | Point {
  busy(1);
  if (wantsCount) return countOf(holder);
  return valueOf(holder);
}

function lastOf(holder: Holder): Holder {
  busy(1);
  const next = nextOf(holder);
  if (next === undefined) return holder;
  return lastOf(next);
}

function lengthOfChain(holder: Holder | undefined): number {
  if (holder === undefined) return 0;
  busy(1);
  return 1 + lengthOfChain(nextOf(holder));
}

function fromAny(value: any): Point {
  busy(2);
  return value;
}

function inTry(holder: Holder): string {
  try {
    const point = valueOf(holder);
    return "x " + show(point.x);
  } catch (error) {
    return "caught " + (error as Error).constructor.name;
  } finally {
    work++;
  }
}

function use(holder: Holder): string {
  const parts: string[] = [];
  const attempt = (name: string, run: () => unknown) => {
    try {
      parts.push(name + " " + show(run()));
    } catch (error) {
      parts.push(name + " threw " + (error as Error).constructor.name);
    }
  };
  attempt("value", () => valueOf(holder));
  attempt("x", () => valueOf(holder).x);
  attempt("x + y", () => { const point = valueOf(holder); return point.x + point.y; });
  attempt("typeof", () => typeof valueOf(holder));
  attempt("count", () => countOf(holder));
  attempt("count + 1", () => countOf(holder) + 1);
  attempt("count | 0", () => countOf(holder) | 0);
  attempt("count < 3", () => countOf(holder) < 3);
  attempt("switch", () => { switch (countOf(holder)) { case 1: return "one"; case 2: return "two"; default: return "many"; } });
  attempt("ok", () => isOk(holder));
  attempt("ok ?", () => (isOk(holder) ? "yes" : "no"));
  attempt("!ok", () => !isOk(holder));
  attempt("ok === true", () => isOk(holder) === true);
  attempt("name", () => nameOf(holder));
  attempt("name.length", () => nameOf(holder).length);
  attempt("name + !", () => nameOf(holder) + "!");
  attempt("next", () => { const next = nextOf(holder); return next === undefined ? "none" : typeof next; });
  attempt("through", () => throughFirst(holder));
  attempt("through.y", () => throughFirst(holder).y);
  attempt("either", () => [countOrPoint(holder, true), countOrPoint(holder, false)]);
  attempt("handed on", () => fromAny(valueOf(holder)));
  attempt("in try", () => inTry(holder));
  attempt("last", () => show(lastOf(holder).count));
  attempt("chain", () => lengthOfChain(holder));
  return parts.join(" | ");
}

function make(count: number): Holder {
  return { value: { x: count, y: count * 2 }, count, ok: count % 2 === 0, name: "h" + count, next: undefined };
}

const odd: any[] = [undefined, null, 0, -0, 1.5, NaN, 2 ** 31, 2 ** 53, "", "text", true, false, 12n, Symbol("s"), [1, 2], { y: 1, x: 2 }, { x: "a" }, { x: 1, y: 2, z: 3 }, () => 1, new Date(0), Object.create(null)];

for (let round = 0; round < 2; round++) {
  const honest = make(round + 1);
  honest.next = make(round + 2);
  console.log("honest", use(honest));
  for (const field of ["value", "count", "ok", "name", "next"]) {
    for (const value of odd) {
      const holder: any = make(2);
      holder[field] = value;
      console.log(field, show(value), "->", use(holder));
    }
    const without: any = make(3);
    delete without[field];
    console.log(field, "deleted ->", use(without));
    const computed: any = make(4);
    Object.defineProperty(computed, field, { get() { work++; return odd[work % odd.length]; } });
    console.log(field, "computed ->", use(computed).length > 0);
  }
}

const points: any[] = [{ x: 1, y: 2 }, "no point", , { x: 3, y: 4 }, 5, null];
for (let index = -1; index <= points.length; index++) {
  let answer: string;
  try {
    const point = at(points, index);
    answer = show(point) + " " + show(point.x);
  } catch (error) {
    answer = "threw " + (error as Error).constructor.name;
  }
  console.log("at", index, answer);
}

// Callers that are no compiled call sites: built-ins, bound functions, call and apply, a getter, a sort.
const holders: any[] = odd.map((value, index) => { const holder: any = make(index); holder.value = value; holder.count = value; return holder; });
console.log(show(holders.map(valueOf)));
console.log(show(holders.map(holder => countOf(holder))));
console.log(show(holders.map(valueOf.bind(null))));
console.log(show(holders.map(holder => valueOf.call(null, holder))));
console.log(show(holders.map(holder => Reflect.apply(throughFirst, null, [holder]))));
console.log(show(holders.slice(2, 9).sort((a, b) => (countOf(a) < countOf(b) ? -1 : 1)).map(holder => holder.count)));
const withGetter = { holder: holders[9], get point(): Point { return valueOf(this.holder); } };
console.log(show(withGetter.point));

async function later(holder: Holder): Promise<string> {
  const point = valueOf(holder);
  await null;
  return show(point) + " " + show(countOf(holder));
}
function* each(list: Holder[]): Generator<Point> {
  for (const holder of list) yield valueOf(holder);
}
console.log(show([...each(holders)]));
console.log(show(await Promise.all(holders.map(later))));
console.log(work > 0);
