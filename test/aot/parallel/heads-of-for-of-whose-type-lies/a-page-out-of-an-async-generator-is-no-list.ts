// `Row[]` is what the checker says of the outer head, `Row` of the inner one. The pages are a list, a set, a text, a generator and nothing.
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
async function* pages(): AsyncGenerator<Row[]> {
  yield [{ id: 1, title: "one", price: 100 }];
  yield taken<Row[]>(new Set([{ id: 2, title: "two", price: 200 }]));
  yield taken<Row[]>("ab");
  yield taken<Row[]>((function* () { yield { price: 3, id: 3, title: "three" }; })());
  yield [{ id: 4, title: "four", price: 400 }];
  yield taken<Row[]>(undefined);
}
async function use(): Promise<unknown> {
  let text = "";
  try {
    for await (const page of pages()) {
      for (const row of page) text += `${row.id},${row.title},${row.price}\n`;
    }
  } catch (error) {
    text += nameOf(error);
  }
  return text;
}
for (let round = 0; round < 3; round++) console.log(await attemptLater(use));
