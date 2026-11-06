// A list, or something that is read as a list is, is read under a key in brackets, and what the read answers goes to every place that expects a value of one kind:
// a list literal, a typed list, arithmetic, a typed parameter, a field of a class, a function with a declared result.
// A program is one receiver, one key and one way in which the key comes. A key is the length, a name of the receiver's own, a name that an object above the receiver has,
// a symbol, a name that reads as a number, or a number.
import type { Random } from "./random";

export const receivers = [
  "a list literal",
  "a list out of a call",
  "a parameter",
  "a typed list of numbers",
  "a typed list of strings",
  "a tuple",
  "an Int32Array",
  "a Float64Array",
  "a Uint8Array",
  "arguments",
  "a string",
  "an instance of a class below Array",
] as const;
export type Receiver = (typeof receivers)[number];

export const keys = [
  "length",
  "a name of its own",
  "at",
  "map",
  "constructor",
  "a symbol",
  'the name "0"',
  'the name "-1"',
  'the name "1.5"',
  "the number 0",
  "the number 7",
] as const;
export type Key = (typeof keys)[number];

export const ways = [
  "a constant",
  "a variable",
  "a parameter",
  "the variable of a loop",
  "a template",
  "one of two",
] as const;
export type Way = (typeof ways)[number];

const written: Record<Key, string> = {
  "length": '"length"',
  "a name of its own": '"extra"',
  "at": '"at"',
  "map": '"map"',
  "constructor": '"constructor"',
  "a symbol": "mark",
  'the name "0"': '"0"',
  'the name "-1"': '"-1"',
  'the name "1.5"': '"1.5"',
  "the number 0": "0",
  "the number 7": "7",
};

const namesElement = (key: Key) => key.startsWith("the n");
const namesFunction = (key: Key) => key === "at" || key === "map" || key === "constructor";
const isAdded = (key: Key) => key === "a name of its own" || key === "a symbol";
const holdsStrings = (receiver: Receiver) => receiver === "a typed list of strings" || receiver === "a string";
const otherOf = (key: Key): Key => (key === "the number 0" ? "length" : "the number 0");

/** No template makes a symbol. */
export const isWritten = (key: Key, way: Way) => !(key === "a symbol" && way === "a template");

/** Whether TypeScript accepts the program with its types. */
export function isAccepted(receiver: Receiver, key: Key): boolean {
  if (isAdded(key)) return false;
  if (receiver === "arguments") return key === "length" || key.startsWith("the number");
  if (receiver === "a string") return key !== "map" && !key.startsWith("the name");
  if (receiver === "a tuple") return key !== "the number 7" && key !== 'the name "-1"' && key !== 'the name "1.5"';
  return true;
}

function typeOfAnswer(receiver: Receiver, key: Key) {
  if (key === "length") return "number";
  if (namesFunction(key)) return "Function";
  return holdsStrings(receiver) ? "string" : "number";
}

export function generate(random: Random, receiver: Receiver, key: Key, way: Way, isTyped: boolean) {
  const typed = (text: string) => (isTyped ? text : "");
  const both = way === "one of two" ? [key, otherOf(key)] : [key];
  const types = [...new Set(both.map(one => typeOfAnswer(receiver, one)))];
  const answer = types.join(" | ");
  const list = types.length > 1 ? `(${answer})[]` : `${answer}[]`;
  const isNumber =
    both.every(one => !namesFunction(one)) && !holdsStrings(receiver) && (!isTyped || answer === "number");

  // No number that a program reads under a name lies between two elements.
  const whole = receiver === "an Int32Array" || receiver === "a Uint8Array";
  const [first, second] = holdsStrings(receiver)
    ? ['"a"', '"b"']
    : random.pick(
        whole
          ? [
              [5, 6],
              [9, 10],
              [100, 101],
            ]
          : [
              [5, 6],
              [5.5, 6.5],
              [9, 10.25],
              [-3, -4],
              [100, 4294967296],
            ],
      );
  const elements = `[${first}, ${second}]`;
  const adds = (name: string) => (isAdded(key) ? `${name}.extra = 7;\n${name}[mark] = 8;\n` : "");

  const read = `${
    receiver === "a list literal"
      ? elements
      : receiver === "a list out of a call"
        ? "make()"
        : receiver === "arguments"
          ? "arguments"
          : "list"
  }[k]`;

  const places = `console.log("literal", [${read}]);
keep([${read}]);
keep([${read}, ${read}]);
const pushed${typed(`: ${list}`)} = [];
pushed.push(${read});
console.log("pushed", pushed, shown(pushed[0]));
keep(pushed);
const stored${typed(`: ${list}`)} = [${read}];
stored[0] = ${read};
console.log("stored", stored, shown(stored[0]));
keep(stored.slice());
${isNumber ? `console.log("arithmetic", ${read} + 1, ${read} * 2, ${read} | 0, -${read}, ${read} < 3);\n` : ""}console.log("handed", take(${read}));
console.log("field", shown(new Holder(${read}).field));
const give = ()${typed(`: ${answer}`)} => ${read};
console.log("returned", shown(give()));
const value = ${read};
console.log("variable", [value], shown(value));
`;

  const text = written[key];
  const literal = namesElement(key) && key.startsWith("the number") ? "number" : text;
  let body: string;
  switch (way) {
    case "a constant":
      body = `const k = ${text};\n${places}`;
      break;
    case "a variable":
      body = `let k${typed(`: ${literal}`)} = ${text};\n${places}`;
      break;
    case "a parameter":
      body = `const under = (k${typed(`: ${literal}`)}) => {\n${places}};\nunder(${text});\n`;
      break;
    case "the variable of a loop":
      body = `for (const k of [${text}]${typed(" as const")}) {\n${places}}\n`;
      break;
    case "a template": {
      const name = text.replaceAll('"', "");
      const cut = Math.ceil(name.length / 2);
      body = `const part = "${name.slice(0, cut)}";\nconst k = \`\${part}${name.slice(cut)}\`${typed(" as const")};\n${places}`;
      break;
    }
    case "one of two":
      body = `const under = (flag${typed(": boolean")}) => {\nconst k = flag ? ${text} : ${written[otherOf(key)]};\n${places}};\nunder(true);\nunder(false);\n`;
      break;
  }

  switch (receiver) {
    case "a list literal":
      break;
    case "a list out of a call":
      body = `function make() {\nconst made = ${elements};\n${adds("made")}return made;\n}\n${body}`;
      break;
    case "a parameter":
      body = `function over(list${typed(": number[]")}) {\n${body}}\nconst handed = ${elements};\n${adds("handed")}over(handed);\n`;
      break;
    case "a typed list of numbers":
      body = `const list${typed(": number[]")} = ${elements};\n${adds("list")}${body}`;
      break;
    case "a typed list of strings":
      body = `const list${typed(": string[]")} = ${elements};\n${adds("list")}${body}`;
      break;
    case "a tuple":
      body = `const list${typed(": [number, number]")} = ${elements};\n${adds("list")}${body}`;
      break;
    case "an Int32Array":
    case "a Float64Array":
    case "a Uint8Array":
      body = `const list = new ${receiver.slice(receiver.indexOf(" ") + 1)}(${elements});\n${adds("list")}${body}`;
      break;
    case "arguments":
      body = `function over(one${typed(": number")}, two${typed(": number")}) {\nconsole.log("over", one, two);\n${adds("arguments")}${body}}\nover(${first}, ${second});\n`;
      break;
    case "a string":
      body = `const list = "ab";\n${body}`;
      break;
    case "an instance of a class below Array":
      body = `class Below extends Array${typed("<number>")} {}\nconst list = new Below();\nlist.push(${first}, ${second});\n${adds("list")}${body}`;
      break;
  }

  return {
    file: isTyped ? "program.ts" : "program.js",
    text: `${isAdded(key) ? 'const mark = Symbol("mark");\n' : ""}const kept${typed(`: ${list}[]`)} = [];
function keep(one${typed(`: ${list}`)}) {
kept.push(one);
}
function shown(value${typed(": unknown")}) {
return typeof value === "function" ? \`function \${value.name}\` : value;
}
function take(value${typed(`: ${answer}`)}) {
return ${isNumber ? "value + 1" : "shown(value)"};
}
class Holder {
field${typed(`: ${answer}`)};
constructor(value${typed(`: ${answer}`)}) {
this.field = value;
}
}
${body}function look() {
${isNumber ? 'let sum = 0;\nfor (const one of kept) sum += one[0];\nconsole.log("sum", sum);\n' : ""}for (const one of kept) console.log("kept", one.length, shown(one[0]), one);
}
look();
`,
  };
}
