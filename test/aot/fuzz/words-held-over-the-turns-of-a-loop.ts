// `for (let i = 0; i < n; i++) { L[k] += v; M[i] = i; t += L[k]; }`: a loop reads and writes one place in memory in every turn: an element
// at an index that does not change, a field of an object, an element of a list. A compiler may read it once ahead of the loop and keep it in
// a register. That is right only if nothing else in the loop writes that place, and here something may: the second array is the first one,
// or a view of its memory that starts some elements later or has another width; the second object is the first one. What varies: what
// holds the place, how it is changed, what is stored under the other name, at which index and in which turns, in which order the two
// stand, and whether the two names mean the same memory, overlap or have nothing to do with each other. No loop holds a call, but for
// one kind: there the holder is an object of one of two classes, and behind a test for the other class stands a helper, a method or a
// setter of that class which changes the same field. Where the holder is of the first class that never runs. There the field may also be
// read, and stored to through the other name, ahead of the loop.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  return `function turnsOf(text${typed ? ": string" : ""})${typed ? ": number" : ""} {
  return JSON.parse(text);
}
`;
}

const wholeKinds = ["Int32Array", "Uint32Array", "Int16Array", "Uint16Array", "Int8Array", "Uint8Array"] as const;
const widthOf = (kind: string) => Number(/\d+/.exec(kind)![0]) / 8;

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const holder = random.weighted([
    [6, "typed"],
    [2, "list"],
    [3, "object"],
    [6, "classes"],
  ] as const);
  const turns = () => random.pick([3, 4, 5, 7, 8, 9, 16, 17]);
  const given = () => random.pick(["1", "2", "7", "-1", "255", "100"]);
  const when = random.weighted([
    [5, ""],
    [2, "if (i === 2) "],
    [2, "if (i & 1) "],
    [1, "if (i > 3) "],
  ] as const);

  // The first name may be an object of either of two classes, and one more access to the field stands behind a test for the other class: in
  // the call where both names mean one object it never runs, and it speaks of the other class's field alone.
  if (holder === "classes") {
    const plain = `${name}P`;
    const other = `${name}Q`;
    const isHeir = random.chance(0.3);
    const guard = isHeir
      ? "instanceof"
      : random.weighted([
          [5, "instanceof"],
          [2, "in"],
          [2, "tag"],
        ] as const);
    const road = random.weighted([
      [typed ? 4 : 2, "helper"],
      [3, "method"],
      [2, "setter"],
    ] as const);
    const step = random.pick(["this.k", "1", "this.k + 1"]);
    const member =
      road === "method"
        ? ` bump() { this.n = (this.n + ${step}) | 0; }`
        : road === "setter"
          ? ` set add(v${as("number")}) { this.n = (this.n + v) | 0; }`
          : "";
    const tagOf = (value: number) => (guard === "tag" ? ` tag${as(String(value))} = ${value};` : "");
    const classes = isHeir
      ? `class ${plain} { n = 1; }\nclass ${other} extends ${plain} { k = 3;${member} }\n`
      : `class ${plain} { n = 1;${tagOf(0)} }\nclass ${other} { n = 1; k = 3;${tagOf(1)}${member} }\n`;
    const helper =
      road === "helper" ? `function ${name}bump(o${as(other)})${as("void")} { o.n = (o.n + o.k) | 0; }\n` : "";
    const test =
      guard === "instanceof" ? `holder instanceof ${other}` : guard === "in" ? `"k" in holder` : "holder.tag === 1";
    const access = `if (${test}) ${road === "helper" ? `${name}bump(holder)` : road === "method" ? "holder.bump()" : "holder.add = 2"};`;
    const change = random.pick([
      "holder.n = (holder.n + 1) | 0;",
      "holder.n = (holder.n + v) | 0;",
      "holder.n = (holder.n ^ j) | 0;",
      "holder.n = (holder.n * 3) | 0;",
    ]);
    const store = `${random.pick(["if (j === 1) ", "if (j === 2) ", "if (j & 1) ", "if (j === w) ", ""])}other.n = ${random.pick(["50", "j", "v", "(seen + 7) | 0"])};`;
    const body = random
      .pick([
        [change, store, access],
        [store, change, access],
        [access, change, store],
        [change, access, store],
      ])
      .join(" ");
    const seen = random.chance(0.6) ? " seen = (seen + holder.n) | 0;" : "";
    // The field may also be read and then stored to through the other name ahead of the loop: whoever reads it once in front of the loop
    // has to read it behind that store.
    const isTouchedAhead = random.chance(0.4);
    const ahead = isTouchedAhead
      ? `const before = holder.n; other.n = ${random.pick(["40", "v", "(before + 7) | 0", "w"])};`
      : "const before = 0;";
    const turn = isTouchedAhead && random.chance(0.5) ? body.replace(store, "") : body;
    const first = isHeir ? plain : `${plain} | ${other}`;
    const text = `${classes}${helper}function ${name}(holder${as(first)}, other${as(plain)}, turns${as("number")}, w${as("number")}, v${as("number")}) {
  let seen = 0;
  ${ahead}
  for (let j = 0; j < turns; j++) { ${turn}${seen} }
  return holder.n + ":" + other.n + ":" + seen + ":" + before;
}
const ${name}one = new ${plain}(), ${name}two = new ${plain}();
`;
    const count = () => `turnsOf("${random.pick([3, 4, 5, 7, 9])}")`;
    const rest = () => `${count()}, ${random.pick([0, 1, 2, 3])}, ${random.pick([1, 2, 7])}`;
    const calls = [
      `${name}(new ${other}(), new ${plain}(), ${rest()})`,
      `${name}(${name}one, ${name}one, ${rest()})`,
      `${name}(${name}two, new ${plain}(), ${rest()})`,
      `${name}(${name}one, ${name}one, ${rest()})`,
    ];
    return { name, text, calls: random.chance(0.7) ? calls : [calls[1], calls[0], calls[3], calls[2]] };
  }

  if (holder === "object") {
    const shape = typed ? "{ total: number; other: number }" : "";
    const change = random.pick([
      "o.total += v;",
      "o.total = o.total + v;",
      "o.total += i;",
      "o.total ^= i;",
      "o.total -= v;",
    ]);
    const store = `${when}p.${random.weighted([
      [5, "total"],
      [1, "other"],
    ] as const)} = ${random.pick(["v", "i", "100", "t & 255", "p.other"])};`;
    const order = random.pick([`${change} ${store}`, `${store} ${change}`, `${change} ${store} ${change}`]);
    const text = `function ${name}(o${as(shape)}, p${as(shape)}, n${as("number")}, v${as("number")}) {
  let t = 0;
  for (let i = 0; i < n; i++) { ${order} t += o.total; }
  return t + ":" + o.total + ":" + p.total;
}
`;
    const calls = [
      `((o${as(shape)}) => ${name}(o, o, ${turns()}, ${given()}))({ total: ${random.pick([0, 1, 50])}, other: 3 })`,
      `${name}({ total: 0, other: 3 }, { total: 9, other: 4 }, ${turns()}, ${given()})`,
      `((o${as(shape)}) => ${name}(o, o, ${turns()}, ${given()}))({ total: 5, other: 8 })`,
    ];
    return { name, text, calls: random.chance(0.5) ? calls : [calls[1], calls[0], calls[2]] };
  }

  const isList = holder === "list";
  const isFloat = !isList && random.chance(0.2);
  const kind = isList ? "number[]" : isFloat ? random.pick(["Float64Array", "Float32Array"]) : random.pick(wholeKinds);
  // A view of another kind over the memory of fractions would show the bits of a NaN, which the language leaves open.
  const otherKind = isList || isFloat || random.chance(0.5) ? kind : random.pick(wholeKinds);
  const change = random.pick([
    "L[k] += v;",
    "L[k] = L[k] + v;",
    "L[k] += M[i];",
    "L[k] += i;",
    isFloat || isList ? "L[k] -= v;" : "L[k] ^= i;",
    "L[k]++;",
  ]);
  const at = random.pick(["i", "i", "i", "i + 1", "n - 1 - i", "k", "i >> 1"]);
  const store = `${when}M[${at}] = ${random.pick(["v", "i", "t & 255", "0", "L[k] + 1"])};`;
  const order = random.pick([`${change} ${store}`, `${store} ${change}`, `${change} ${store} ${change}`]);
  const text = `function ${name}(L${as(kind)}, M${as(otherKind)}, n${as("number")}, k${as("number")}, v${as("number")}) {
  let t = 0;
  for (let i = 0; i < n; i++) { ${order} t += L[k]; }
  return t + ":" + L.join();
}
`;
  const call = (relation: "same" | "shifted" | "apart") => {
    const n = turns();
    const length = n + random.pick([1, 2, 4]);
    const content = `[${Array.from({ length }, (_, index) => (index * 7 + random.below(5)) % 100).join(", ")}]`;
    const k = random.below(Math.min(n, 6));
    const made = isList ? content : `new ${kind}(${content})`;
    if (isList || (relation === "same" && otherKind === kind)) {
      const other = relation === "apart" ? (isList ? `[${content.slice(1, -1)}]` : `new ${kind}(${length})`) : "L";
      return `((L${as(kind)}) => ${name}(L, ${other}, ${n}, ${k}, ${given()}))(${made})`;
    }
    if (relation === "apart") return `${name}(${made}, new ${otherKind}(${length * 8}), ${n}, ${k}, ${given()})`;
    const skipped = relation === "same" ? 0 : random.pick([1, 2, 3]) * Math.max(widthOf(kind), widthOf(otherKind));
    return `((L${as(kind)}) => ${name}(L, new ${otherKind}(L.buffer, ${skipped}), ${n}, ${k}, ${given()}))(new ${kind}(new ArrayBuffer(${Math.ceil((length * widthOf(kind)) / 8) * 8 + 64})).fill(${random.pick([1, 3, 9])}))`;
  };
  return { name, text, calls: random.shuffled([call("same"), call("shifted"), call("apart"), call("same")]) };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
