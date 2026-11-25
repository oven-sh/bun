// `Row` is what the checker says of each head. One list holds what is no such row, and what is one in another way than the literal that the type was written for.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const nameOf = (error: unknown): string => (error as Error).constructor.name;
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return nameOf(error);
  }
};
const attemptLater = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    return show(await run());
  } catch (error) {
    return nameOf(error);
  }
};
// Nobody can follow a value through a property of the global object.
function taken<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
interface Row { id: number; title: string; price: number }
class Listed {
  id = 7;
  title = "listed";
  price = 700;
}
class Longer extends Listed {
  more = true;
}
function rows(): Row[] {
  return taken<Row[]>([
    { id: 1, title: "one", price: 100 },
    JSON.parse('{"id":2,"title":"two","price":200}'),
    ,
    undefined,
    new Listed(),
    new Longer(),
    { price: 400, title: "four", id: 4 },
    { id: 8, get title() { return "got"; }, price: 800 },
    new Proxy({ id: 9, title: "nine", price: 900 }, { get: (target, key, receiver) => (key === "title" ? "from the proxy" : Reflect.get(target, key, receiver)) }),
    { id: 10, title: "ten", price: 1000 },
  ]);
}
function use(): unknown {
  let text = "";
  for (const row of rows()) {
    try {
      text += `${row.id},${row.title},${row.price} `;
    } catch (error) {
      text += nameOf(error) + " ";
    }
  }
  return text;
}
async function* later(): AsyncGenerator<Row> {
  for (const row of rows()) yield row;
}
async function useLater(): Promise<unknown> {
  let text = "";
  for await (const row of later()) {
    try {
      text += `${row.id},${row.title},${row.price} `;
    } catch (error) {
      text += nameOf(error) + " ";
    }
  }
  return text;
}
function* some(): Generator<string> {
  for (const row of rows()) {
    if (row == null) continue;
    yield `${row.id}:${row.title.length}`;
    if (row.id === 9) break;
  }
}
function total(list: Iterable<Row>): number {
  let sum = 0;
  for (const row of list) sum += row?.price ?? -1;
  return sum;
}
for (let round = 0; round < 3; round++) console.log(attempt(use), await attemptLater(useLater), [...some()].join(" "), total(rows()), total(new Set(rows())));
