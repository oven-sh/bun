// `parse` of the JSON of "bun" validates wherever the compiler sees that a call with a type argument calls it, whatever type the program has given the function on the way. Where it does not see that, the call reaches the function itself, which throws whatever the text holds.
import { JSON as Typed } from "bun";

type User = { id: number };
interface Codec {
  parse<T>(text: string): T;
}

function attempt(name: string, run: (text: string) => unknown) {
  for (const text of ['{"id":7}', '{"id":"7"}']) {
    try {
      console.log(name, "takes", JSON.stringify(run(text)));
    } catch (error) {
      console.log(name, "issues" in (error as object) ? "refuses the value" : "throws whatever the text holds");
    }
  }
}

const codec: Codec = Typed;
const codecOfBun: Codec = Bun.JSON;
const read: <T>(text: string) => T = Typed.parse;
const holder = { codec: Typed as Codec };
function through(given: Codec, text: string) {
  return given.parse<User>(text);
}

attempt("an interface of the program", text => codec.parse<User>(text));
attempt("an interface of the program over Bun.JSON", text => codecOfBun.parse<User>(text));
attempt("a function type of the program", text => read<User>(text));
attempt("a cast of the function", text => (Typed.parse as <T>(text: string) => T)<User>(text));
attempt("a cast of the object", text => (Typed as Codec).parse<User>(text));
attempt("any", text => Typed.parse<any>(text));
attempt("a field", text => holder.codec.parse<User>(text));
attempt("a parameter", text => through(Typed, text));
attempt("call", text => Typed.parse.call(Typed, text));
attempt("apply", text => Typed.parse.apply(Typed, [text]));
attempt("bind", text => Typed.parse.bind(Typed)(text));
attempt("a callback", text => [text].map(Typed.parse as (text: string) => unknown)[0]);
