// Small programs in which one call reaches either of two built-in functions, and one thing is done with what the call answers.
//
//   the two functions     drawn from about five hundred: they answer lists, objects of every built-in class, plain objects, primitives or nothing, or they throw
//   how they arrive       as a parameter, through `?:`, out of a table by index, out of a field, a variable, a closure, a map, a pattern, a default, a rest parameter, a function that picks,
//                         under one of two names on the object that holds both, out of a field of the object that the call is made on
//   how the call is made  plainly, with `call`, `apply`, `Reflect.apply`, `new`, `Reflect.construct`, a spread, `?.()`
//   what is done          one of: `length`, `Array.isArray`, `typeof`, an index, a spread, `for-of`, a pattern, a method, `instanceof`, the prototype, a store, a sum ..
//
// The call runs once for each of the two, and each answer is printed at once. A program does one thing with the answer: a second look at it could tell the compiler what the first may not assume.
import type { Random } from "./random";

type Holder = { holder: string; members: string; receivers?: string[]; from?: string; isConstructed?: true };

const lists = ["[3, 1, 2]", '["b", "a"]', "[1.5, , 2]", "[[1, 2], [3, 4]]", "[]"];
const texts = ['"a,b"', '"abc"', '""', '"12"'];

// `members` are called on one of `receivers`; a holder without receivers holds functions that need none.
export const holders: Holder[] = [
  {
    holder: "Object",
    members:
      "getPrototypeOf getOwnPropertyDescriptor getOwnPropertyDescriptors getOwnPropertyNames getOwnPropertySymbols keys create seal freeze preventExtensions isSealed isFrozen isExtensible is assign values entries fromEntries hasOwn groupBy defineProperty defineProperties setPrototypeOf",
  },
  {
    holder: "Object.prototype",
    members: "toString toLocaleString valueOf hasOwnProperty propertyIsEnumerable isPrototypeOf __lookupGetter__",
    receivers: ["{ a: 1 }", "[1]", '"a"', "5"],
  },
  { holder: "Array", members: "from of isArray fromAsync" },
  {
    holder: "Array.prototype",
    members:
      "toString values concat fill join pop push reverse shift slice sort splice unshift every forEach some indexOf lastIndexOf filter flat flatMap reduce reduceRight map keys entries find findLast findIndex findLastIndex includes copyWithin at toReversed toSorted toSpliced with",
    receivers: [...lists, "{ length: 2, 0: 1, 1: 2 }", '"ab"'],
  },
  { holder: "String", members: "fromCharCode fromCodePoint raw" },
  {
    holder: "String.prototype",
    members:
      "toString valueOf charAt charCodeAt codePointAt concat indexOf replace replaceAll repeat padStart slice at substring toUpperCase localeCompare trim startsWith includes match search matchAll split normalize isWellFormed",
    receivers: texts,
  },
  { holder: "Number", members: "isFinite isNaN isSafeInteger parseInt parseFloat isInteger" },
  { holder: "Number.prototype", members: "valueOf toFixed toPrecision toString", receivers: ["5", "1.5"] },
  { holder: "Symbol", members: "for keyFor" },
  { holder: "BigInt", members: "asUintN asIntN" },
  { holder: "Math", members: "abs ceil hypot max min pow sign trunc imul" },
  { holder: "JSON", members: "parse stringify rawJSON isRawJSON" },
  {
    holder: "Reflect",
    members:
      "apply construct defineProperty deleteProperty get getOwnPropertyDescriptor getPrototypeOf has isExtensible ownKeys preventExtensions set setPrototypeOf",
  },
  { holder: "Proxy", members: "revocable" },
  { holder: "Promise", members: "resolve reject race all allSettled any withResolvers try", receivers: ["Promise"] },
  { holder: "Promise.prototype", members: "finally then catch", receivers: ["Promise.resolve(1)"] },
  { holder: "Map", members: "groupBy" },
  {
    holder: "Map.prototype",
    members: "clear delete entries forEach get has keys set values",
    receivers: ["new Map([[1, 2]])", 'new Map([["a", [1]]])'],
  },
  {
    holder: "Set.prototype",
    members:
      "add clear delete entries forEach has keys values union intersection difference symmetricDifference isSubsetOf",
    receivers: ["new Set([1, 2])"],
  },
  { holder: "WeakMap.prototype", members: "delete get has set", receivers: ["new WeakMap()"] },
  { holder: "WeakSet.prototype", members: "delete has add", receivers: ["new WeakSet()"] },
  { holder: "WeakRef.prototype", members: "deref", receivers: ["new WeakRef({})"] },
  { holder: "Date", members: "parse UTC" },
  {
    holder: "Date.prototype",
    members: "toISOString valueOf getTime getUTCFullYear getUTCDay setTime setUTCHours toJSON toUTCString",
    receivers: ["new Date(0)"],
  },
  { holder: "RegExp", members: "escape" },
  { holder: "RegExp.prototype", members: "exec toString test", receivers: ["/a/", "/(a)|b/g"] },
  { holder: "Error", members: "captureStackTrace isError" },
  { holder: "Error.prototype", members: "toString", receivers: ['new Error("e")'] },
  { holder: "ArrayBuffer", members: "isView" },
  { holder: "ArrayBuffer.prototype", members: "slice resize transfer", receivers: ["new ArrayBuffer(8)"] },
  {
    holder: "DataView.prototype",
    members: "getInt8 getFloat64 getBigInt64 setInt8",
    receivers: ["new DataView(new ArrayBuffer(8))"],
  },
  { holder: "Uint8Array", members: "from of fromBase64 fromHex", receivers: ["Uint8Array", "Float64Array"] },
  {
    holder: "Uint8Array.prototype",
    members:
      "toBase64 toHex toString copyWithin sort every filter entries includes fill find findIndex forEach indexOf join keys map reduce reverse set slice some subarray toReversed toSorted with at values",
    receivers: ["new Uint8Array([3, 1, 2])", "new Float64Array([1.5, 2])", "new BigInt64Array(2)"],
  },
  { holder: "Atomics", members: "add and compareExchange exchange isLockFree load notify or store sub xor" },
  { holder: "Iterator", members: "from" },
  {
    holder: "Iterator.prototype",
    members: "toArray forEach some every find reduce map filter take drop flatMap",
    receivers: ["[1, 2, 3].values()", "new Set([1]).values()"],
  },
  { holder: "[].values()", members: "next", receivers: ["[1, 2].values()", "[].entries()"] },
  { holder: "new Map().entries()", members: "next", receivers: ["new Map([[1, 2]]).entries()"] },
  { holder: '"".matchAll(/a/g)', members: "next", receivers: ['"aa".matchAll(/a/g)'] },
  { holder: "new Set().values()", members: "next", receivers: ["new Set([1]).values()"] },
  { holder: '""[Symbol.iterator]()', members: "next", receivers: ['"ab"[Symbol.iterator]()'] },
  {
    holder: "(function* () {})()",
    members: "next return throw",
    receivers: ["(function* () { yield [1]; })()"],
  },
  {
    holder: "(async function* () {})()",
    members: "next return throw",
    receivers: ["(async function* () { yield [1]; })()"],
  },
  {
    holder: "Intl",
    members:
      "getCanonicalLocales supportedValuesOf Collator DateTimeFormat ListFormat NumberFormat PluralRules Segmenter",
  },
  {
    holder: "Intl.NumberFormat.prototype",
    members: "formatToParts resolvedOptions",
    receivers: ['new Intl.NumberFormat("en")'],
  },
  { holder: "Intl.ListFormat.prototype", members: "format formatToParts", receivers: ['new Intl.ListFormat("en")'] },
  { holder: "Function.prototype", members: "apply call bind", receivers: ["all", "Made"] },
  {
    holder: "globalThis",
    members:
      "structuredClone atob btoa isNaN isFinite escape unescape decodeURIComponent encodeURIComponent parseInt parseFloat",
  },
  {
    holder: "globalThis",
    isConstructed: true,
    members:
      "Object Array String Number Boolean Symbol BigInt Map Set WeakMap WeakSet WeakRef RegExp Error TypeError AggregateError Promise Proxy ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int32Array Float32Array Float64Array BigInt64Array FinalizationRegistry Iterator",
  },
  {
    holder: "globalThis",
    isConstructed: true,
    members:
      "Buffer URL URLSearchParams TextEncoder TextDecoder Headers Response Request Blob AbortController Event CustomEvent EventTarget FormData DOMException",
  },
  { holder: "Buffer", members: "alloc byteLength compare concat from isBuffer isEncoding" },
  {
    holder: "Buffer.prototype",
    members: "toString toJSON slice subarray equals indexOf includes readUInt8 write fill",
    receivers: ['Buffer.from("abc")'],
  },
  { holder: "URL", members: "parse canParse" },
  {
    holder: "URLSearchParams.prototype",
    members: "get getAll has keys values entries toString",
    receivers: ['new URLSearchParams("a=1&a=2")'],
  },
  { holder: "TextEncoder.prototype", members: "encode encodeInto", receivers: ["new TextEncoder()"] },
  { holder: "TextDecoder.prototype", members: "decode", receivers: ["new TextDecoder()"] },
  {
    holder: "Headers.prototype",
    members: "get has keys entries toJSON getSetCookie getAll",
    receivers: ["new Headers({ a: 1 })"],
  },
  { holder: "Response", members: "json error" },
  { holder: "AbortSignal", members: "abort any" },
  { holder: "Event.prototype", members: "composedPath", receivers: ['new Event("e")'] },
  {
    holder: "Bun",
    members:
      "inspect deepEquals escapeHTML stringWidth stripANSI concatArrayBuffers fileURLToPath pathToFileURL peek indexOfLine",
  },
  { holder: "path", from: "node:path", members: "parse join basename dirname extname normalize isAbsolute format" },
  { holder: "util", from: "node:util", members: "format inspect isDeepStrictEqual stripVTControlCharacters parseArgs" },
  { holder: "util.types", from: "node:util", members: "isProxy isPromise isTypedArray" },
  { holder: "querystring", from: "node:querystring", members: "parse stringify escape" },
  { holder: "url", from: "node:url", members: "fileURLToPath pathToFileURL domainToASCII urlToHttpOptions" },
];

export type BuiltIn = {
  text: string;
  holder: string;
  member: string;
  receivers?: string[];
  from?: [name: string, specifier: string];
  isConstructed: boolean;
};

export const builtIns: BuiltIn[] = holders.flatMap(({ holder, members, receivers, from, isConstructed }) =>
  members.split(" ").map(member => ({
    text: holder === "globalThis" ? member : `${holder}.${member}`,
    holder,
    member,
    receivers,
    from: from && ([holder.split(".")[0], from] as [string, string]),
    isConstructed: !!isConstructed,
  })),
);

export const operands = [
  "{}, {}",
  "",
  "{ a: 1, b: [2] }",
  '{ a: 1 }, "a"',
  "{ a: 1 }, { b: { value: 2, enumerable: true } }",
  "[3, 1, 2]",
  "[3, 1, 2], larger",
  "same",
  "former",
  '[["a", 1], ["b", 2]]',
  "[[1, 2]]",
  '"a,b", ","',
  '"[1, 2]"',
  '"{}"',
  "'{ \"a\": [1] }'",
  '"a"',
  '"en"',
  '"http://a.example/b?c=1"',
  "/a/g",
  "2",
  "0, 1",
  "1, 2, 3",
  "-1",
  "1.5",
  "2n",
  "8, 2n",
  "null",
  "undefined, {}",
  "new Uint8Array(4), 0, 1",
  "new ArrayBuffer(8)",
  "new Map([[1, 2]])",
  "new Set([1, 2])",
  "[1, 2].values()",
  "all, null, [{ a: 1 }]",
  "Made, [2]",
  "Made, {}",
  "Promise.resolve([1])",
  "[Promise.resolve(1)]",
  "Symbol.iterator",
  "{ length: 2 }",
  "{ raw: [1, 2] }, 3",
  "settle",
  '{ dir: "/a", base: "b" }',
];

// Functions of the program that operands and receivers name. Each says the same text about itself wherever it runs.
const functions = {
  same: "each => each",
  larger: "each => each > 1",
  former: "(a, b) => a",
  all: "(...all) => all",
  settle: "resolve => resolve([1])",
  Made: "function () {}",
};

// `@` is the call.
export const uses = [
  "@.length",
  "Array.isArray(@)",
  "typeof @",
  "@[0]",
  "@[1]",
  "[...@].length",
  "(() => { let count = 0; for (const each of @) count++; return count; })()",
  "(() => { const [one, other] = @; return other; })()",
  "(() => { const { length } = @; return length; })()",
  "(() => { const { proxy, value, done, a } = @; return [typeof proxy, typeof value, done, a].join(); })()",
  "@.slice(0, 1)",
  "@.slice(0, 1).length",
  "@.map(each => each).length",
  "@.join()",
  "@.at(-1)",
  "@.indexOf(1)",
  "@.includes(1)",
  "@.concat([1]).length",
  "@.push(1)",
  "@.pop()",
  "@.forEach(each => each)",
  "@.toString()",
  "@.valueOf() === undefined",
  '@.hasOwnProperty("length")',
  "@ instanceof Array",
  "@ instanceof Object",
  "@ instanceof Map",
  "@ instanceof Promise",
  "Object.getPrototypeOf(@) === Array.prototype",
  "Object.getPrototypeOf(@) === Object.prototype",
  "@.constructor === Array",
  "@.constructor === Object",
  "@.constructor.name",
  '"length" in @',
  "0 in @",
  "Object.keys(@).length",
  "Object.keys(@).join()",
  "Reflect.ownKeys(@).length",
  "JSON.stringify(@)",
  "Object.prototype.toString.call(@)",
  "@ === undefined",
  "@ == null",
  "@?.length",
  "@?.[0]",
  "!@",
  "@ ? 1 : 2",
  "@ + 1",
  "@ * 2",
  "`${@}`",
  "@.size",
  "@.byteLength",
  "typeof @.then",
  "typeof @.next",
  "typeof @.proxy",
  "typeof @.revoke",
  "@.value",
  "@.done",
  "@.a",
  "@.has(1)",
  "@.get(1)",
  "(() => { const answer = @; answer.length = 1; return answer.length; })()",
  "(() => { const answer = @; answer[0] = 7; return answer[0]; })()",
  "(() => { const answer = @; answer[5] = 7; return answer.length; })()",
  "(() => { const answer = @; answer.extra = 7; return answer.extra; })()",
  "(() => { const answer = @; delete answer[0]; return 0 in answer; })()",
  "Array.from(@).length",
  "Object.entries(@).length",
  "Object.isFrozen(@)",
  "new Set(@).size",
  "Math.max(...@)",
  "String(@).length",
  "Number(@)",
  "[].concat(@).length",
  "Array.prototype.slice.call(@).length",
  "Object.assign({}, @).length",
  "({ ...@ }).length",
  "structuredClone(@)?.length",
  "typeof [].concat(@)[0]",
  "typeof Array.from(@)[0]",
  "typeof Object.values(@)[0]",
  "typeof [...@][0]",
  "Object.entries(@).join()",
  "typeof @.proxy?.a",
  "typeof @.value?.[0]",
];

// `F` is what is called, `R` a receiver, `P` the operands.
export const calls = {
  plainly: "F(P)",
  "with call": "F.call(R, P)",
  "with apply": "F.apply(R, [P])",
  "with Reflect.apply": "Reflect.apply(F, R, [P])",
  "with new": "new (F)(P)",
  "with Reflect.construct": "Reflect.construct(F, [P])",
  "with a spread": "F(...[P])",
  "if there is one": "F?.(P)",
};

// `A` and `B` are the two functions, `@` is what is done with the call of `F`, and `second` says which of the two a turn is about. `turn(second)` answers.
// `H` is an object on which both are found, `A` under the name `M` and `B` under the name `N`.
export const arrivals = {
  "a parameter": ["f", "function reach(f) { return @; }\nconst turn = second => reach(second ? B : A);"],
  "a parameter of two calls": [
    "f",
    "function reach(f) { return @; }\nconst turn = second => { if (second) return reach(B); return reach(A); };",
  ],
  "a conditional": ["(second ? B : A)", "const turn = second => @;"],
  "a table by index": ["[A, B][index]", "const turn = second => { const index = Number(second); return @; };"],
  "a table that is kept": [
    "table[index]",
    "const table = [A, B];\nconst turn = second => { const index = Number(second); return @; };",
  ],
  "a table under names": [
    "table[name]",
    'const table = { first: A, second: B };\nconst turn = second => { const name = second ? "second" : "first"; return @; };',
  ],
  "a field": ["holder.f", "const holder = { f: A };\nconst turn = second => { if (second) holder.f = B; return @; };"],
  "a field read first": [
    "f",
    "const holder = { f: A };\nconst turn = second => { if (second) holder.f = B; const f = holder.f; return @; };",
  ],
  "a variable": ["f", "const turn = second => { let f = A; if (second) f = B; return @; };"],
  "a variable of the file": ["f", "let f = A;\nconst turn = second => { if (second) f = B; return @; };"],
  "a closure": ["f", "let f = A;\nconst run = () => @;\nconst turn = second => { if (second) f = B; return run(); };"],
  "a function that picks": [
    "pick(second)",
    "function pick(second) { return second ? B : A; }\nconst turn = second => @;",
  ],
  "what is there otherwise": ["((second ? undefined : A) ?? B)", "const turn = second => @;"],
  "a map": ["map.get(second)", "const map = new Map([[false, A], [true, B]]);\nconst turn = second => @;"],
  "a pattern": ["f", "const turn = second => { const { f } = second ? { f: B } : { f: A }; return @; };"],
  "a default": ["f", "function reach(f = A) { return @; }\nconst turn = second => reach(second ? B : undefined);"],
  "a rest parameter": [
    "all[index]",
    "function reach(index, ...all) { return @; }\nconst turn = second => reach(Number(second), A, B);",
  ],
  "a field of an instance": [
    "this.f",
    "class Holder { constructor(f) { this.f = f; } run() { return @; } }\nconst turn = second => new Holder(second ? B : A).run();",
  ],
  "a static field": [
    "Holder.f",
    "class Holder { static f = A; }\nconst turn = second => { if (second) Holder.f = B; return @; };",
  ],
  "a bound function": [
    "f",
    "function reach(f) { return @; }\nconst turn = second => reach(second ? B.bind(R) : A.bind(R));",
  ],
  "a loop over a list": [
    "f",
    "const turn = second => { for (const f of [A, B].slice(Number(second), Number(second) + 1)) return @; };",
  ],
  "one of two names": ["H[name]", 'const turn = second => { const name = second ? "N" : "M"; return @; };'],
  "one of two names in a table": [
    "H[names[index]]",
    'const names = ["M", "N"];\nconst turn = second => { const index = Number(second); return @; };',
  ],
  "a field of the receiver": ["receiver.f", "const turn = second => { receiver.f = second ? B : A; return @; };"],
} satisfies Record<string, [string, string]>;

const arrivalsUnderNames = ["one of two names", "one of two names in a table"] as const;
/** The ways in which any two functions arrive. The others take two functions of one holder, or a receiver that takes a store. */
export const arrivalsOfAnyTwo = (Object.keys(arrivals) as (keyof typeof arrivals)[]).filter(
  arrival => arrival !== "a field of the receiver" && !arrivalsUnderNames.some(other => other === arrival),
);

export type Choice = {
  first: BuiltIn;
  second: BuiltIn;
  arrival: keyof typeof arrivals;
  call: keyof typeof calls;
  use: string;
  /** One for each of the two functions. Where `isWrittenOut`, the first stands in the call. */
  receivers: [string, string];
  /** Where `isWrittenOut`, the first stands in the call. Otherwise the call takes three variables, and runs once for each list. */
  operands: string[];
  isWrittenOut: boolean;
  /** No promise that the program makes is rejected, so it listens for none. Whoever listens hands a function to the host. */
  rejectsNothing?: true;
};

const replaced = (text: string, parts: Record<string, string>) =>
  text.replace(/@|\b[ABFRPHMN]\b/g, part => parts[part] ?? part);

export function textOf(choice: Choice): string {
  const { first, second, arrival, call, use, receivers, operands, isWrittenOut, rejectsNothing } = choice;
  const [callee, frame] = arrivals[arrival];
  const receiver = isWrittenOut ? receivers[0] : "receiver";
  const names = {
    A: first.text,
    B: second.text,
    R: receiver,
    H: first.receivers ? receiver : first.holder,
    M: first.member,
    N: second.member,
  };
  const theCall = replaced(calls[call], {
    ...names,
    F: replaced(callee, names),
    P: isWrittenOut ? operands[0] : "p, q, r",
  });
  const imports = new Map([first.from, second.from].filter(from => from !== undefined));
  return `${[...imports].map(([name, specifier]) => `import ${name} from "${specifier}";\n`).join("")}${rejectsNothing ? "" : 'process.on("unhandledRejection", () => {});\n'}const show = value => ((typeof value === "object" && value !== null) || typeof value === "function" ? Object.prototype.toString.call(value) : typeof value + " " + String(value));
let receiver, p, q, r;
${Object.entries(functions)
  .filter(([name]) => [...operands, ...receivers].some(text => text.split(/\W+/).includes(name)))
  .map(([name, text]) => `const ${name} = Object.defineProperty(${text}, "toString", { value: () => "${name}" });\n`)
  .join("")}${replaced(frame, { ...names, "@": use.replace("@", () => theCall) })}
const lists = [${(isWrittenOut ? [""] : operands).map(list => `() => [${list}]`).join(", ")}];
for (const second of [process.argv.length > 99, process.argv.length < 99]) {
  for (const list of lists) {
    receiver = second ? ${receivers[1]} : ${receivers[0]};
    [p, q, r] = list();
    try {
      console.log(show(turn(second)));
    } catch (error) {
      console.log("THROWS", error?.name);
    }
  }
}
`;
}

export function choose(random: Random): Choice {
  const first = random.pick(builtIns);
  const beside = builtIns.filter(
    other => other !== first && other.holder === first.holder && other.isConstructed === first.isConstructed,
  );
  const isUnderNames = beside.length > 0 && random.chance(0.3);
  return chooseFor(
    random,
    first,
    random.pick(isUnderNames ? beside : builtIns.filter(other => other !== first)),
    isUnderNames,
    !isUnderNames && !!first.receivers && random.chance(0.3),
  );
}

export function chooseFor(
  random: Random,
  first: BuiltIn,
  second: BuiltIn,
  isUnderNames: boolean,
  mayBeOnReceiver = false,
): Choice {
  const takesReceiver = !!(first.receivers ?? second.receivers);
  const isConstructed = (first.isConstructed || second.isConstructed) && random.chance(0.6);
  const receivers = [first, second].map(({ receivers }) => (receivers ? random.pick(receivers) : "undefined")) as [
    string,
    string,
  ];
  // A built-in object takes no stores.
  const isOnReceiver = mayBeOnReceiver && !/^([A-Z]\w*|undefined)$/.test(receivers[0]);
  if (isUnderNames || isOnReceiver) receivers[1] = receivers[0];
  // Where the receiver is written out, both functions are called on it, and a built-in object takes no stores.
  const isWrittenOut =
    random.chance(0.4) && !/^[A-Z]\w*$/.test(receivers[0] === "undefined" ? receivers[1] : receivers[0]);
  return {
    first,
    second,
    arrival: isUnderNames
      ? random.pick(arrivalsUnderNames)
      : isOnReceiver
        ? "a field of the receiver"
        : random.pick(arrivalsOfAnyTwo),
    call: isConstructed
      ? random.pick(["with new", "with new", "with Reflect.construct"])
      : isUnderNames || isOnReceiver
        ? random.pick(["plainly", "plainly", "plainly", "with a spread", "if there is one"])
        : takesReceiver && random.chance(0.9)
          ? random.pick(["with call", "with call", "with apply", "with Reflect.apply"])
          : random.pick(["plainly", "plainly", "plainly", "with a spread", "if there is one", "with call"]),
    use: random.pick(uses),
    receivers: isWrittenOut && receivers[0] === "undefined" ? [receivers[1], receivers[1]] : receivers,
    operands: random.sample(operands, 8),
    isWrittenOut,
  };
}

export const generate = (random: Random) => textOf(choose(random));
