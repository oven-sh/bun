// The same copy is made many times from sources that only a lookup can read (a proxy, the environment, a namespace, an object with getters), and from dictionaries
// that an ordinary object is copied from word by word. Each copy is an object of its own with the keys in the source's order, whatever the earlier copies have taught the run time.
import * as namespace from "node:path";

const lines: string[] = [];
const show = (what: string, value: object): void => { lines.push(what + " " + JSON.stringify(value, (_key, member) => (typeof member === "function" ? "function" : member)) + " | " + Reflect.ownKeys(value).map(String).join(",")); };

type Settings = { name: string; level?: number; [key: string]: unknown };
const tag = Symbol("tag");
let reads = 0;
const behindProxy = new Proxy<Record<string, unknown>>({ alpha: 1, beta: "two", gamma: null, delta: undefined, epsilon: [1] }, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
const withGetters = { get first() { reads++; return 1; }, second: 2, get third() { return "three"; }, fourth: 4, fifth: 5 };
const withHidden = Object.defineProperty({ shown: 1, alsoShown: 2, third: 3, fourth: 4 }, "hidden", { value: 1, enumerable: false });
const withIndexes: Record<string, unknown> = { b: 1, 2: "two", a: 2, 1: "one", c: 3 };
const withSymbol: Record<string | symbol, unknown> = { a: 1, [tag]: "tagged", b: 2, c: 3, d: 4 };
const withOwnProto = JSON.parse('{"a":1,"__proto__":{"inherited":true},"b":2,"c":3,"d":4}') as Record<string, unknown>;
const ofNull: Record<string, unknown> = Object.assign(Object.create(null), { a: 1, b: 2, c: 3, d: 4 });
const frozen = Object.freeze({ a: 1, b: 2, c: 3, d: 4 });
process.env["COPIED_ONE"] = "1";
process.env["COPIED_TWO"] = "2";

const intoSettings = (source: Record<string | symbol, unknown>): Settings => ({ name: "settings", ...source, level: 3 });
const intoDictionary = (source: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> => ({ ...source, [key]: value });

let dictionary: Record<string, unknown> = {};
for (let turn = 0; turn < 200; turn++) {
  const isShown = turn < 2 || turn === 199;
  const made: [string, object][] = [
    ["proxy", intoSettings(behindProxy)],
    ["getters", intoSettings(withGetters)],
    ["hidden", intoSettings(withHidden)],
    ["indexes", intoSettings(withIndexes)],
    ["symbol", intoSettings(withSymbol)],
    ["own __proto__", intoSettings(withOwnProto)],
    ["of null", intoSettings(ofNull)],
    ["frozen", intoSettings(frozen)],
    ["array", intoSettings([1, 2, 3, 4, 5] as unknown as Record<string, unknown>)],
    ["string", { name: "s", ...("text" as unknown as object) }],
    ["dictionary of null", intoDictionary(ofNull, "e", turn)],
    ["dictionary of frozen", intoDictionary(frozen, "a", turn)],
    ["dictionary with indexes", intoDictionary(withIndexes, "0", turn)],
    ["dictionary with own __proto__", intoDictionary(withOwnProto, "z", turn)],
  ];
  if (isShown) {
    for (const [what, value] of made) show(turn + " " + what, value);
    const environment = intoSettings(process.env as Record<string, unknown>);
    lines.push(turn + " environment " + environment["COPIED_ONE"] + environment["COPIED_TWO"] + " " + environment.name + environment.level + " " + (Object.keys(environment).length - Object.keys(process.env).length));
    const paths = intoSettings(namespace as unknown as Record<string, unknown>);
    lines.push(turn + " namespace " + typeof paths["join"] + " " + paths.name + paths.level + " " + (Object.keys(paths).length - Object.keys(namespace).length));
    lines.push(turn + " prototype " + (Object.getPrototypeOf(made[6]![1]) === Object.prototype) + (Object.getPrototypeOf(made[10]![1]) === Object.prototype) + Object.isFrozen(made[11]![1]) + Object.isExtensible(made[7]![1]));
  }
  // A copy does not share what it holds with its source.
  const before = dictionary;
  dictionary = intoDictionary(dictionary, "k" + (turn % 12), turn);
  if (turn % 12 === 11) delete dictionary["k3"];
  if (before === dictionary || ("k" + (turn % 12) in before && before["k" + (turn % 12)] === turn)) lines.push(turn + " shared");
}
show("dictionary", dictionary);
lines.push("reads " + reads);
console.log(lines.join("\n"));
