// validate<T>(value) where T is a union of undefined and a type with a Schema.Default: undefined goes to the first arm that accepts it, alone, as a member and as an element.
import { validate } from "bun:bundle";
import type { Schema } from "bun";

type Level = (number & Schema.Default<1>) | undefined;
type Reversed = undefined | (number & Schema.Default<1>);

const parse = (text: string): any => JSON.parse(text);
function withUndefined(text: string): any {
  const value = parse(text);
  value.level = undefined;
  return value;
}
function show(what: string, run: () => unknown): void {
  let shown: string;
  try {
    const value: any = run();
    shown = typeof value === "object" && value !== null ? Object.keys(value).join() + " " + JSON.stringify(value) : String(value);
  } catch (error) {
    shown = error instanceof TypeError ? "TypeError" : "thrown: " + String(error);
  }
  console.log(what + ":", shown);
}

show("alone, undefined", () => validate<Level>(undefined));
show("alone, a number", () => validate<Level>(parse("2")));
show("alone, a string", () => validate<Level>(parse('"2"')));
show("alone, null", () => validate<Level>(null));
show("undefined written first, undefined", () => validate<Reversed>(undefined));
show("undefined written first, a number", () => validate<Reversed>(parse("2")));

show("a member, absent", () => validate<{ level: Level }>(parse("{}")));
show("a member, undefined", () => validate<{ level: Level }>(withUndefined("{}")));
show("a member, a number", () => validate<{ level: Level }>(parse('{"level":3}')));
show("a member, a string", () => validate<{ level: Level }>(parse('{"level":"3"}')));
show("a member after another, absent", () => validate<{ name: string; level: Level }>(parse('{"name":"a"}')));
show("a member after another, undefined", () => validate<{ name: string; level: Level }>(withUndefined('{"name":"a"}')));

show("an optional member, absent", () => validate<{ level?: Level }>(parse("{}")));
show("an optional member, undefined", () => validate<{ level?: Level }>(withUndefined("{}")));
show("an optional member, a number", () => validate<{ level?: Level }>(parse('{"level":3}')));

show("an element", () => validate<Level[]>([undefined, 2]));
show("a tuple element", () => validate<[Level, Level]>([undefined, 2]));
show("a dictionary value", () => validate<Record<string, Level>>(withUndefined('{"other":2}')));
