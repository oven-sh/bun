// A class below another that no code of the program constructs by name. Its class object goes one road out of sight, an instance comes back, and typed code uses it as an instance of the class above.
// One program a road: the road is the only place where the compiler could see the class constructed.
import { generated } from "./generated/run-generated";
import { tsconfig } from "./generated/typed-object-mutations";

const roads: [string, string][] = [
  ["Reflect.construct", `Reflect.construct(C, [])`],
  ["a function out of run-time text", `new Function("C", "return new C()")(C)`],
  ["Array.of", `(Array.of as Function).call(C)`],
  ["eval", `(0, eval)("C => new C()")(C)`],
  ["a bound function", `new (C.bind(null))()`],
  ["a Proxy", `new (new Proxy(C, {}))()`],
  ["a callback of map", `[C].map(D => new D())[0]`],
  ["the new target of the class above", `Reflect.construct(Above, [], C)`],
  ["Object.create", `Object.create(C.prototype, Object.getOwnPropertyDescriptors(new Above()))`],
  [
    "the constructor property of its prototype object",
    `new (Object.getPrototypeOf(Object.create(C.prototype)).constructor)()`,
  ],
  ["a key put together at run time", `new ({ C }[["C"].join("")] as Maker)()`],
  ["Object.setPrototypeOf", `Object.setPrototypeOf(new Above(), C.prototype)`],
];

const textOf = (road: string) => `
const lines: string[] = [];
const say = (text: string): void => { lines.push(text); };
class Above {
  x = 1;
  y = "y";
  name(): string { return "above"; }
  get size(): number { return 10; }
  sum(): number { return this.x + this.size; }
}
class Below extends Above {
  z = 3.5;
  x = 100;
  name(): string { return "below"; }
  get size(): number { return 20 + this.z; }
}
class Beside {
  y = 7;
  x = "beside";
  name(): string { return "beside"; }
}
function use(a: Above): string {
  return a.name() + " " + a.x + " " + a.y + " " + a.size + " " + a.sum() + " " + (a instanceof Below) + " " + Object.keys(a).join("+");
}
function useEither(a: Above | Beside): string {
  return a.name() + " " + a.x + " " + a.y;
}
type Maker = new () => Above;
const road = (C: Maker): Above => ${road};
say(use(new Above()));
say(useEither(new Above()));
const made = road(Below);
say(use(made));
say(useEither(made));
const list: Above[] = [new Above(), made, new Above()];
let text = "";
for (const each of list) text += each.name() + each.size + ",";
say(text);
const other = road(Beside as unknown as Maker);
say(useEither(other));
console.log(lines.join("\\n"));
`;

generated(
  "an instance of a class that is constructed out of sight answers as itself",
  roads.map(([name, road], index) => ({
    name: `by ${name}.`,
    isAlwaysRun: index < 4,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: textOf(road), files: { "tsconfig.json": tsconfig } }),
  })),
);
