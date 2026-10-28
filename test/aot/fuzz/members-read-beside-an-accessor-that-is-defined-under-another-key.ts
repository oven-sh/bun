// Small programs about one object, one member that a descriptor defines on it, and a read of another member, whose value is then asked for its kind. An accessor under one key says nothing about what
// stands under another: the length of a list is a number whatever a getter under an index answers. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the object    lists of numbers, fractions, texts and objects, a list with holes, a text object, a typed array, `arguments`, an object that looks like a list, a literal, an instance of a
//                 class, a function, a `Map`, a pattern, a number object; written where it is used, or what a function returns
//   the key       indexes inside and outside the list, as numbers and as texts, `length`, names, a name that is computed
//   the descriptor  a getter and a setter, either alone, a value, with and without the other attributes; the getter answers a text, a number, a fraction, an object, a list, a function,
//                 `undefined`, `null`, a truth value
//   defined by    `Object.defineProperty`, `Reflect.defineProperty`, `Object.defineProperties`, `__defineGetter__` and `__defineSetter__`; inside a handler or not
//   the read      `length`, elements, names, `size`, `lastIndex`, the key itself, `at`, `indexOf`, the number of keys; ahead of the definition, behind it, or both
//   its kind      one `typeof` test with work that fits the kind, or a row of them; in a function that is handed the value, or where it is read
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const [made, reads] = random.weighted<[string, string[]]>([
    [
      5,
      [
        "[1, 2, 3]",
        ["o.length", "o.length", "o[0]", "o[1]", "o[2]", "o.at(1)", "o.indexOf(3)", "Object.keys(o).length"],
      ],
    ],
    [2, ['["a", "b", "c"]', ["o.length", "o[0]", "o[1]", "o.at(-1)"]]],
    [2, ["[1.5, 2.5, 3.5]", ["o.length", "o[0]", "o[1]", "o[2]"]]],
    [2, ["[{ deep: 1 }, { deep: 2 }]", ["o.length", "o[0]", "o[1]"]]],
    [1, ["new Array(3)", ["o.length", "o[0]", "o[1]"]]],
    [1, ["[1, , 3]", ["o.length", "o[0]", "o[1]", "o[2]"]]],
    [4, ['new String("abc")', ["o.length", "o.length", "o[0]", "o[1]", "o.charAt(1)", "o.valueOf()"]]],
    [2, ["new Uint8Array(3)", ["o.length", "o[0]", "o[1]", "o.byteLength"]]],
    [2, ["(function () {\nreturn arguments;\n})(1, 2, 3)", ["o.length", "o[0]", "o[1]"]]],
    [2, ["{ 0: 1, 1: 2, length: 2 }", ["o.length", "o[0]", "o[1]"]]],
    [3, ["{ x: 1, y: 2 }", ["o.x", "o.y", "Object.keys(o).length"]]],
    [3, ["new Kind()", ["o.x", "o.y", "Object.keys(o).length"]]],
    [1, ["function (a, b) {}", ["o.length", "o.name"]]],
    [1, ["new Map([[1, 2]])", ["o.size", "o.get(1)"]]],
    [1, ["/x/g", ["o.lastIndex", "o.source", "o.global"]]],
    [1, ["new Number(5)", ["o.valueOf()", "o.x"]]],
  ]);
  const key = random.pick([
    "1",
    "1",
    "1",
    "0",
    "5",
    '"1"',
    '"0"',
    '"x"',
    '"y"',
    '"length"',
    '["1"][0]',
    '["x"][0]',
    "2",
  ]);
  const answer = random.pick([
    '"got"',
    '"got"',
    '"got"',
    "7",
    "1.5",
    "{ deep: 1 }",
    "[1]",
    "() => 1",
    "undefined",
    "null",
    "true",
  ]);
  const getter = `get() {\nreturn ${answer};\n}`;
  const setter = random.pick([
    "set(given) {}",
    "set(given) {\nconsole.log(given);\n}",
    "set(given) {\nconsole.log(tell(given));\n}",
  ]);
  const others = random.pick(["", "", "configurable: true", "enumerable: true,\nconfigurable: true"]);
  const parts = random.weighted([
    [6, [getter, setter]],
    [2, [setter, getter]],
    [2, [getter]],
    [2, [setter]],
    [2, [`value: ${answer}`]],
    [1, [`value: ${answer}`, "writable: true"]],
  ]);
  const descriptor = `{\n${[...parts, others].filter(Boolean).join(",\n")},\n}`;
  const isAPair = parts.length === 2 && parts.includes(getter) && parts.includes(setter);
  const defines = random.weighted([
    [6, `Object.defineProperty(o, ${key}, ${descriptor});`],
    [2, `Reflect.defineProperty(o, ${key}, ${descriptor});`],
    [2, `Object.defineProperties(o, { [${key}]: ${descriptor} });`],
    [
      isAPair ? 2 : 0,
      `o.__defineGetter__(${key}, function () {\nreturn ${answer};\n});\no.__defineSetter__(${key}, function (given) {});`,
    ],
  ]);
  const handled = random.chance(0.5)
    ? `try {\n${defines}\n} catch (error) {\nconsole.log("refused", error.constructor.name);\n}`
    : defines;

  const kindOf: Record<string, string> = {
    '"got"': "string",
    "7": "number",
    "1.5": "number",
    "{ deep: 1 }": "object",
    "[1]": "object",
    "() => 1": "function",
    undefined: "undefined",
    null: "object",
    true: "boolean",
  };
  const work: Record<string, string> = {
    string: '"text " + v + v.length',
    number: '"number " + (v + 1)',
    object: '"object " + (v === null ? "null" : Object.keys(v).length)',
    function: '"function " + v.length',
    undefined: '"nothing"',
    boolean: '"truth " + !v',
  };
  const kinds = random.chance(0.6) ? [kindOf[answer]] : random.shuffled(Object.keys(work));
  const tests = kinds.map(kind => `if (typeof v === "${kind}") return ${work[kind]};`).join("\n");
  const usesTell = setter.includes("tell(") && parts.includes(setter);
  const isHandedOver = usesTell || random.chance(0.7);
  const tell = isHandedOver
    ? `function tell(v) {\n${tests}\nreturn "other " + String(typeof v === "function" ? "function" : v);\n}`
    : "";
  const shows = (read: string) =>
    isHandedOver
      ? `console.log(tell(${read}));`
      : `{\nconst v = ${read};\nconsole.log(typeof v === "${kinds[0]}" ? ${work[kinds[0]]} : "other " + String(typeof v === "function" ? "function" : v));\n}`;
  const read = random.pick(reads);
  const itself = `o[${key}]`;
  const moments = random.pick(["ahead", "ahead", "behind", "behind", "both", "both", "both"] as const);
  const scene = [
    moments !== "behind" ? shows(read) : "",
    handled,
    moments !== "ahead" ? shows(read) : "",
    random.chance(0.3) ? shows(itself) : "",
    random.chance(0.2) ? shows(random.pick(reads)) : "",
  ]
    .filter(Boolean)
    .join("\n");

  const kind = made === "new Kind()" ? "class Kind {\nx = 1;\ny = 2;\n}" : "";
  const isReturned = random.chance(0.6);
  const make = isReturned ? `function make() {\nreturn ${made};\n}` : "";
  const born = `const o = ${isReturned ? "make()" : made};`;
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const head = [tell, kind, make].filter(Boolean).join("\n");
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const place = random.pick(["top", "once", "once", "once", "thrice"] as const);
  if (place === "top") return { file, text: `${head ? head + "\n" : ""}${guarded(`${born}\n${scene}`)}\n` };
  return {
    file,
    text: `${head ? head + "\n" : ""}function run() {\n${born}\n${scene}\n}\n${guarded(place === "once" ? "run();" : "run();\nrun();\nrun();")}\n`,
  };
}
