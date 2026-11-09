// `Held` is what the checker says of the head. The second value that is stepped to lets go in a way of its own.
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
class Held {
  name = "held";
  [Symbol.dispose]() { console.log("let go of", this.name); }
}
function use(): unknown {
  let text = "";
  for (using held of taken<Held[]>([new Held(), { name: 7, [Symbol.dispose]() { console.log("its own way out"); } }, new Held()])) text += show(held.name) + " ";
  return text;
}
function useNothing(): unknown {
  let text = "";
  for (using held of taken<Held[]>([new Held(), undefined, null, new Held()])) text += show(held?.name) + " ";
  return text;
}
function useWhatCannotLetGo(): unknown {
  let text = "";
  for (using held of taken<Held[]>([new Held(), { name: "no way out" }, new Held()])) text += show(held.name) + " ";
  return text;
}
for (let round = 0; round < 3; round++) console.log(attempt(use), attempt(useNothing), attempt(useWhatCannotLetGo));
