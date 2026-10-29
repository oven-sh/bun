// A built-in that begins with ToObject(this) and hands that object on: to its callback as the last argument, or back as its result. For a primitive receiver it is
// the wrapper made of it, a String, Number, Boolean, Symbol or BigInt object, and never the primitive. Every such built-in, called in every way that a method can be borrowed,
// with a receiver that the compiler knows more or less about, and behind it every use that tells a wrapper from its primitive.

// What is done with `all`, the object that was handed on. `receiver` is what the built-in was called on.
const uses: Record<string, string> = {
  "typeof": "typeof all",
  "first element": "all[0]",
  "element by a variable": "all[zero]",
  "element past the end": "all[7]",
  "length": "all.length",
  "joined to a text": 'all + "!"',
  "in a template": "`<${all}>`",
  "strictly equal": "all === receiver",
  "loosely equal": "all == receiver",
  "Object.is": "Object.is(all, receiver)",
  "instanceof": "[String, Number, Boolean, Symbol, BigInt, Array, Object].filter(kind => all instanceof kind).map(kind => kind.name).join()",
  "class by toString": "Object.prototype.toString.call(all)",
  "truthiness": 'all ? "truthy" : "falsy"',
  "negated": "!all",
  "or": 'typeof (all || "other")',
  "valueOf": "typeof all.valueOf() + String(all.valueOf() === receiver)",
  "a method of strings": 'typeof all.charAt === "function" ? all.charAt(0) + all.charCodeAt(0) + all.slice(1) : "none"',
  "a store and a read": "(all.extra = 7, all.extra)",
  "a store, then an element": "(all.extra = 7, all[0])",
  "own keys": "Object.keys(all).join()",
  "JSON": "JSON.stringify(all)",
  "spread": "typeof all[Symbol.iterator] === \"function\" ? [...all].join() : \"not iterable\"",
  "in a Set with the receiver": "new Set([all, receiver]).size",
  "as a key": "({ abc: 1, 5: 2, true: 3 })[all]",
  "prototype": "Object.getPrototypeOf(all) === Object.getPrototypeOf(receiver)",
  "handed to a function": "describe(all)",
};
const usesOfResults = ["typeof", "first element", "length", "joined to a text", "strictly equal", "instanceof", "truthiness", "valueOf", "a store and a read", "in a Set with the receiver", "handed to a function"];

// `USE` stands where the use goes. 
const withCallback: Record<string, { entry: string; parameters: string; rest?: string; answer?: string }> = {
  forEach: { entry: "Array.prototype.forEach", parameters: "value, index, all" },
  map: { entry: "Array.prototype.map", parameters: "value, index, all" },
  filter: { entry: "Array.prototype.filter", parameters: "value, index, all" },
  every: { entry: "Array.prototype.every", parameters: "value, index, all", answer: "true" },
  some: { entry: "Array.prototype.some", parameters: "value, index, all" },
  find: { entry: "Array.prototype.find", parameters: "value, index, all" },
  findIndex: { entry: "Array.prototype.findIndex", parameters: "value, index, all" },
  findLast: { entry: "Array.prototype.findLast", parameters: "value, index, all" },
  findLastIndex: { entry: "Array.prototype.findLastIndex", parameters: "value, index, all" },
  flatMap: { entry: "Array.prototype.flatMap", parameters: "value, index, all" },
  reduce: { entry: "Array.prototype.reduce", parameters: "sum, value, index, all", rest: "0" },
  reduceRight: { entry: "Array.prototype.reduceRight", parameters: "sum, value, index, all", rest: "0" },
};
const withResult: Record<string, { entry: string; arguments?: string; take?: string; isCalledPlainly?: true }> = {
  reverse: { entry: "Array.prototype.reverse" },
  sort: { entry: "Array.prototype.sort" },
  fill: { entry: "Array.prototype.fill", arguments: "1, 9" },
  copyWithin: { entry: "Array.prototype.copyWithin", arguments: "9" },
  concat: { entry: "Array.prototype.concat", take: "[0]" },
  valueOf: { entry: "Object.prototype.valueOf" },
  "Object()": { entry: "Object", isCalledPlainly: true },
  "new Object()": { entry: "new Object", isCalledPlainly: true },
  "Object.assign": { entry: "Object.assign", isCalledPlainly: true },
};

export const waysToCall: Record<string, (entry: string, self: string, list: string[]) => string> = {
  "call": (entry, self, list) => `${entry}.call(${[self, ...list].join(", ")})`,
  "apply": (entry, self, list) => `${entry}.apply(${self}, [${list.join(", ")}])`,
  "Reflect.apply": (entry, self, list) => `Reflect.apply(${entry}, ${self}, [${list.join(", ")}])`,
  "call of call": (entry, self, list) => `Function.prototype.call.call(${[entry, self, ...list].join(", ")})`,
  "call of apply": (entry, self, list) => `Function.prototype.apply.call(${entry}, ${self}, [${list.join(", ")}])`,
  "Reflect.apply of call": (entry, self, list) => `Reflect.apply(Function.prototype.call, ${entry}, [${[self, ...list].join(", ")}])`,
  "bind": (entry, self, list) => `${entry}.bind(${self})(${list.join(", ")})`,
  "call bound to the method": (entry, self, list) => `Function.prototype.call.bind(${entry})(${[self, ...list].join(", ")})`,
  "a helper that binds call": (entry, self, list) => `uncurried(${entry})(${[self, ...list].join(", ")})`,
  "a variable that holds the method": (entry, self, list) => `(held = ${entry}, held.call(${[self, ...list].join(", ")}))`,
};

// How much the compiler can know of the receiver where the built-in is called.
export const knowledge: Record<string, (literal: string, body: string) => string> = {
  // The literal stands in the call itself: see `self` in program().
  "a literal": (literal, body) => `{ const receiver = ${literal};\n${body}}\n`,
  "a constant": (literal, body) => `{ const receiver = ${literal};\n${body}}\n`,
  "a value nobody knows": (literal, body) => `{ const receiver = hide(${literal});\n${body}}\n`,
  "a variable that is stored twice": (literal, body) => `{ let receiver = [1, 2, 3]; if (zero === 0) receiver = ${literal};\n${body}}\n`,
  "a parameter that takes two kinds": (literal, body) => `for (const receiver of [${literal}, [1, 2, 3], ${literal}]) {\n${body}}\n`,
};

const textReceivers = ['"abc"', '"a"'];
const otherReceivers = ['"abc"', '""', "5", "0", "true", "false", 'Symbol.for("s")', "10n"];

const head = `const zero = process.argv.length > 99 ? 1 : 0;
const hide = value => [value, undefined][zero];
const uncurried = method => Function.prototype.call.bind(method);
let held;
function describe(value) { return typeof value + ":" + (typeof value === "object" ? Object.prototype.toString.call(value) : "primitive"); }
function line(label, run) {
  let answer;
  try { answer = String(run()); } catch (error) { answer = "THROWN " + error.name; }
  console.log(label + " | " + answer);
}
`;

export function program(way: string, known: string) {
  const self = (literal: string) => (known === "a literal" ? literal : "receiver");
  const call = (entry: string, literal: string, list: string[]) => waysToCall[way](entry, self(literal), list);
  let text = head;
  for (const literal of textReceivers) {
    let body = "";
    for (const [name, { entry, parameters, rest, answer }] of Object.entries(withCallback)) {
      for (const [use, expression] of Object.entries(uses)) {
        const callback = `function (${parameters}) { got.push(${expression}); return ${answer ?? "undefined"}; }`;
        body += `  line(${JSON.stringify(`${name} of ${literal}, ${use}`)}, () => { const got = []; ${call(entry, literal, [callback, ...(rest ? [rest] : [])])}; return got.join(" "); });\n`;
      }
    }
    text += knowledge[known](literal, body);
  }
  for (const literal of otherReceivers) {
    let body = "";
    for (const [name, { entry, arguments: list, take, isCalledPlainly }] of Object.entries(withResult)) {
      // These take the value as an argument, so there is one way to call them.
      const made = isCalledPlainly ? `${entry}(${self(literal)})` : call(entry, literal, list ? [list] : []);
      for (const use of usesOfResults) body += `  line(${JSON.stringify(`${name} of ${literal}, ${use}`)}, () => { const all = ${made}${take ?? ""}; return ${uses[use]}; });\n`;
    }
    text += knowledge[known](literal, body);
  }
  return { file: "program.js", text };
}

// The same with one call in the whole program. How much the compiler follows of a built-in depends on how many calls reach it, so a way of calling that is right among many calls
// may be wrong alone, and the other way round.
export const methodsWithCallback = Object.keys(withCallback);
export function programOfOneCall(way: string, name: string) {
  const { entry, parameters, rest, answer } = withCallback[name];
  const seen = 'typeof all + ":" + all[index] + ":" + (all instanceof String) + ":" + (all === "abc") + ":" + all.length';
  const callback = `function (${parameters}) { got.push(${seen}); return ${answer ?? "undefined"}; }`;
  const text = `const uncurried = method => Function.prototype.call.bind(method);\nlet held;\nconst got = [];\n${waysToCall[way](entry, '"abc"', [callback, ...(rest ? [rest] : [])])};\nconsole.log(got.join(" "));\n`;
  return { file: "program.js", text };
}
