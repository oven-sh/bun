// None, one, two, three, four and five arguments; `thisArg`; a callback that is no function; one that throws; one that changes the length of the list; a bound function, a host function, a class.
function none(list: number[]): string {
  const out: string[] = [];
  for (const run of [() => (list as any).some(), () => (list as any).map(), () => (list as any).filter(), () => (list as any).forEach(), () => (list as any).reduce(), () => (list as any).at()]) {
    try {
      out.push(String(run()));
    } catch (error) {
      out.push((error as Error).constructor.name + ": " + (error as Error).message);
    }
  }
  return out.join(" | ");
}
function withThis(list: number[], limit: { least: number }): string {
  function over(this: { least: number }, v: number): boolean {
    return v > this.least;
  }
  return [list.some(over, limit), list.filter(over, limit).join(), list.every(over, limit), list.find(over, limit), list.findIndex(over, limit), list.map(over, limit).join()].join(" ");
}
function many(list: number[]): string {
  const f = (v: number, i: number, all: number[]) => v + i + all.length;
  return [(list as any).map(f, undefined, 1).join(), (list as any).map(f, undefined, 1, 2).join(), (list as any).map(f, undefined, 1, 2, 3).join(), (list as any).reduce((a: number, v: number) => a + v, 10, 1, 2)].join(" ");
}
function throwing(list: number[]): string {
  let calls = 0;
  try {
    list.forEach(v => {
      calls++;
      if (v === 2) throw new RangeError("at two");
    });
  } catch (error) {
    return calls + " " + (error as Error).message;
  }
  return "nothing thrown";
}
function changing(): string {
  const grows = [1, 2, 3];
  const seenWhileGrowing: number[] = [];
  grows.forEach(v => {
    seenWhileGrowing.push(v);
    if (grows.length < 6) grows.push(v * 10);
  });
  const shrinks = [1, 2, 3, 4];
  const seenWhileShrinking: number[] = [];
  shrinks.some(v => {
    seenWhileShrinking.push(v);
    shrinks.length = 2;
    return false;
  });
  const turnsSparse: any[] = [1, 2, 3];
  const mapped = turnsSparse.map((v, i) => {
    if (i === 0) delete turnsSparse[1];
    return v;
  });
  return [seenWhileGrowing.join(), grows.join(), seenWhileShrinking.join(), JSON.stringify(mapped), 1 in mapped].join(" ");
}
function others(list: unknown[]): string {
  class Box {
    constructor(public v: unknown) {}
  }
  const out: string[] = [list.filter(Boolean).join(), list.map(String).join("|"), list.map(Number.isInteger).join(), list.some(Array.isArray).toString(), list.map(Math.abs.bind(Math) as any).join()];
  try {
    list.map(Box as any);
  } catch (error) {
    out.push((error as Error).constructor.name);
  }
  return out.join(" ");
}
const list = [1, 2, 3];
console.log(none(list));
console.log(withThis(list, { least: 1 }));
console.log(many(list));
console.log(throwing(list));
console.log(changing());
console.log(others([0, 1, "", "a", null, -2]));
