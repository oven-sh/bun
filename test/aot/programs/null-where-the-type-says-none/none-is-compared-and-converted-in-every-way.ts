interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function all(point: Point, text: string, run: () => void, list: number[]): string {
  const out: unknown[] = [];
  for (const value of [point, text, run, list] as unknown[]) out.push(value === null, value === undefined, value == null, typeof value, String(value), `${value}`, value + "", !value, !!value, value ?? "d", Object.is(value, null), Object.is(value, undefined), [value].join(), JSON.stringify([value]), value instanceof Object);
  out.push(point === (null as any), text === (undefined as any), point == (text as any), Object.is(point, run));
  return out.join(" ");
}
console.log(all(null as any, null as any, null as any, null as any)); console.log(all(undefined as any, undefined as any, undefined as any, undefined as any)); console.log(all(null as any, undefined as any, null as any, undefined as any)); console.log(all(origin, "t", () => {}, [1]).length);
