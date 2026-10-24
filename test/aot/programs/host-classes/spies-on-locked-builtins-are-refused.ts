// In a compiled executable `spyOn` refuses a fixed member of a built-in. Compiled code calls such a member without looking it up, so a spy on it would never be called. Math.floor is fixed like the members of the prototypes.
import { spyOn } from "bun:test";

const joined = (list: number[]) => list.join("-");
const page = (text: string) => new URL(text).searchParams.get("page");
const header = (headers: Headers) => headers.get("a");
const floored = (value: number) => Math.floor(value);
const own = { method: (): string => "real" };
const input = "http://127.0.0.1:3000/users/7?page=2";

function attempt(label: string, lay: () => { mock: { calls: unknown[] }; mockRestore(): void }, call: () => unknown) {
  const before = call();
  try {
    const spy = lay();
    console.log(label + ": " + before + ", spied: " + call() + ", calls " + spy.mock.calls.length);
    spy.mockRestore();
  } catch (error) {
    console.log(label + ": " + before + ", throws " + (error as Error).name);
  }
  console.log(label + " afterwards: " + call());
}

attempt("Array.prototype.join", () => spyOn(Array.prototype, "join").mockReturnValue("spied"), () => joined([1, 2]));
attempt("Math.floor", () => spyOn(Math, "floor").mockReturnValue(-7), () => floored(1.5));
attempt("URLSearchParams.prototype.get", () => spyOn(URLSearchParams.prototype, "get").mockReturnValue("spied"), () => page(input));
attempt("Headers.prototype.get", () => spyOn(Headers.prototype, "get").mockReturnValue("spied"), () => header(new Headers({ a: "1" })));
attempt("Response.prototype.clone", () => spyOn(Response.prototype, "clone").mockReturnValue(new Response("spied")), () => typeof new Response("x").clone());

const names = process.argv.length > 99 ? ["x"] : ["join"];
attempt("a name that is not known at build time", () => spyOn(Array.prototype as unknown as Record<string, () => string>, names[0]).mockReturnValue("spied"), () => joined([3, 4]));

attempt("an object of the program", () => spyOn(own, "method").mockReturnValue("spied"), () => own.method());
