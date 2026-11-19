// `Row` is what the checker says of the head. The second value that is stepped to is a text.
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
function use0(): unknown {
  let text = "";
  for (const { id, title = "none", ...rest } of taken<Row[]>([{ id: 1, title: "one", price: 100 }, "text", { id: 1, title: "one", price: 100 }])) text += show(`${id},${title}`) + " ";
  return text;
}
function use1(): unknown {
  let text = "";
  for (const { id, title = "none", ...rest } of taken<Row[]>([{ id: 1, title: "one", price: 100 }, "text", { id: 1, title: "one", price: 100 }])) text += show(id + 1) + " ";
  return text;
}
function use2(): unknown {
  let text = "";
  for (const { id, title = "none", ...rest } of taken<Row[]>([{ id: 1, title: "one", price: 100 }, "text", { id: 1, title: "one", price: 100 }])) text += show(title.length) + " ";
  return text;
}
function use3(): unknown {
  let text = "";
  for (const { id, title = "none", ...rest } of taken<Row[]>([{ id: 1, title: "one", price: 100 }, "text", { id: 1, title: "one", price: 100 }])) text += show(Object.keys(rest).join()) + " ";
  return text;
}
for (let round = 0; round < 3; round++) console.log(attempt(use0), attempt(use1), attempt(use2), attempt(use3));
