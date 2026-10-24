// A function with annotated parameters is called, through untyped code, with arguments that do not match them. Whatever is passed gets in, a number for an object too, and JSON.parse<T> and validate<T> in the body, and in the functions nested in it, validate all the same: the only TypeErrors are theirs, with issues.
import { validate } from "bun:bundle";

type Point = { x: number; y: number };
type Options = { strict: boolean; name: string };
const hide = (value: unknown): any => value;
const bad = '{"x":"s","y":1}';
const good = '{"x":1,"y":2}';
const fitting: Options = { strict: true, name: "n" };
const others: [string, any][] = [["fitting options", fitting], ["options of other types", { strict: "yes", name: 5 }], ["empty options", {}], ["a number for options", 5], ["null for options", null], ["nothing for options", undefined], ["an array for options", [1]]];

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": value " + JSON.stringify(run()));
  } catch (error: any) {
    console.log(label + ": " + error.name + (error.issues ? " with " + error.issues.length + " issues" : ""));
  }
}

function declared(text: string, options: Options): unknown {
  const point = JSON.parse<Point>(text);
  return [point, point.x + point.y, typeof options];
}
const arrow = (text: string, options: Options): unknown => {
  const point = JSON.parse<Point>(text);
  return [point, point.x + point.y, typeof options];
};
function validating(text: string, options: Options): unknown {
  const point = validate<Point>(JSON.parse(text));
  return [point, point.x + point.y, typeof options];
}
function nesting(options: Options): (text: string) => unknown {
  return text => {
    const point = JSON.parse<Point>(text);
    return [point, point.x + point.y, typeof options];
  };
}
function nestingDeclared(options: Options): (text: string) => unknown {
  function inner(text: string): unknown {
    return JSON.parse<Point>(text);
  }
  return inner;
}
class Handler {
  constructor(public options: Options) {}
  handle(text: string, options: Options): unknown {
    const point = JSON.parse<Point>(text);
    return [point, point.x + point.y, typeof options, typeof this.options];
  }
  static handle(text: string, options: Options): unknown {
    return JSON.parse<Point>(text);
  }
}
const literal = {
  handle(text: string, options: Options): unknown {
    return JSON.parse<Point>(text);
  },
};
function destructuring(text: string, { strict, name }: Options): unknown {
  return [JSON.parse<Point>(text), typeof strict, typeof name];
}
function withDefault(text: string, options: Options = fitting): unknown {
  return [JSON.parse<Point>(text), typeof options];
}
let current = good;
function defaulted(options: Options, point = JSON.parse<Point>(current)): unknown {
  return [point, typeof options];
}
class Built {
  point: Point;
  constructor(text: string, options: Options) {
    this.point = JSON.parse<Point>(text);
  }
}
class WithField {
  point = JSON.parse<Point>(current);
  constructor(public options: Options) {}
}
class WithSetter {
  held: unknown = null;
  set options(value: Options) {
    this.held = JSON.parse<Point>(current);
  }
}
function returningTyped(text: string, options: Options): Point {
  return JSON.parse<Point>(text);
}
function withReviver(text: string, options: Options): unknown {
  return JSON.parse<Point>(text, (key, value) => value);
}
function inATry(text: string, options: Options): unknown {
  try {
    return JSON.parse<Point>(text);
  } catch (error: any) {
    return "caught " + error.name + (error.issues ? " with issues" : "");
  }
}
function inALoop(text: string, options: Options): unknown {
  const points: Point[] = [];
  for (let round = 0; round < 3; round++) points.push(JSON.parse<Point>(text));
  return points.length;
}
async function asynchronous(text: string, options: Options): Promise<unknown> {
  await null;
  return JSON.parse<Point>(text);
}
function* generating(text: string, options: Options): Generator<unknown> {
  yield JSON.parse<Point>(text);
}

for (const [label, options] of others) {
  for (const text of [good, bad]) {
    const what = (text === good ? "a text that matches, " : "a text that does not match, ") + label;
    const isChecked = typeof options === "number";
    const isAnotherObject = typeof options === "object" && options !== null && options !== fitting;
    attempt("a declared function, " + what, () => hide(declared)(text, options));
    if (!isChecked) attempt("a declared function called by name, " + what, () => declared(text, hide(options)));
    attempt("an arrow function, " + what, () => hide(arrow)(text, options));
    attempt("validate, " + what, () => hide(validating)(text, options));
    attempt("a nested arrow function, " + what, () => hide(nesting)(options)(text));
    attempt("a nested declared function, " + what, () => hide(nestingDeclared)(options)(text));
    attempt("a method, " + what, () => hide(new Handler(fitting)).handle(text, options));
    if (!isChecked) attempt("a method of an instance made with them, " + what, () => new (hide(Handler))(options).handle(text, options));
    attempt("a static method, " + what, () => hide(Handler).handle(text, options));
    attempt("a method of a literal, " + what, () => hide(literal).handle(text, options));
    if (!isAnotherObject) attempt("a destructured parameter, " + what, () => hide(destructuring)(text, options));
    attempt("a parameter with a default, " + what, () => hide(withDefault)(text, options));
    attempt("call, " + what, () => declared.call(null, text, hide(options)));
    attempt("apply, " + what, () => declared.apply(null, hide([text, options])));
    attempt("bind, " + what, () => hide(declared.bind(null, text))(options));
    attempt("Reflect.apply, " + what, () => Reflect.apply(declared, null, [text, options]));
    if (!isChecked) attempt("a callback of map, " + what, () => [text].map(hide((given: string) => declared(given, hide(options)))));
    attempt("the function itself as a callback of map, " + what, () => [text].map(hide(declared)));
    current = text;
    attempt("a default value of a parameter, " + what, () => hide(defaulted)(options));
    attempt("a constructor, " + what, () => new (hide(Built))(text, options).point);
    if (!isChecked) attempt("a field initializer, " + what, () => new (hide(WithField))(options).point);
    attempt("a setter, " + what, () => {
      const target = hide(new WithSetter());
      target.options = options;
      return target.held;
    });
    attempt("a function that returns the type, " + what, () => hide(returningTyped)(text, options));
    attempt("with a reviver, " + what, () => hide(withReviver)(text, options));
    attempt("in a try, " + what, () => hide(inATry)(text, options));
    attempt("in a loop, " + what, () => hide(inALoop)(text, options));
    attempt("a generator, " + what, () => [...hide(generating)(text, options)]);
  }
}
for (const [label, options] of others) {
  for (const text of [good, bad]) {
    try {
      console.log("an async function, " + label + ": value " + JSON.stringify(await hide(asynchronous)(text, options)));
    } catch (error: any) {
      console.log("an async function, " + label + ": " + error.name + (error.issues ? " with " + error.issues.length + " issues" : ""));
    }
  }
}
