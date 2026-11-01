// Writes scenes whose one parameter is a size: how many cases a switch has, how many elements a list literal, how many fields an object, how many operands a call, how deep a chain of calls goes.
// A compiler treats 8 of something otherwise than 9 of it. The sizes are drawn next to the numbers at which this one changes what it does (`bun build --aot-list=registry` lists them), one below, at and one above.
// Beside the size a scene is plain code as people write it, with one odd thing in one place: a value of another kind, a hole, a getter, a member that is missing.
// One kind of scene has a declared type in place of a size, and one value that is not what the type says.
// A scene prints once, at its end.
import { randomFrom } from "./print-members-of-objects.ts";

const borders = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 250, 254, 256, 512, 1024, 2000, 4096];

class Sizes {
  readonly lines: string[] = [];
  readonly files: [string, string][] = [];
  readonly imports: string[] = [];
  private count = 0;
  constructor(
    private readonly random: () => number,
    private readonly isTypeScript: boolean,
    private readonly tag: string,
    /** Every size of the scene, for whoever asks for one. */
    private readonly only?: number,
  ) {}

  below = (bound: number) => Math.floor(this.random() * bound);
  chance = (percent: number) => this.random() * 100 < percent;
  pick = <T>(from: readonly T[]) => from[this.below(from.length)];
  plainly = <T>(percent: number, plain: T, other: () => T) => (this.chance(percent) ? plain : other());
  typed = (type: string) => (this.isTypeScript ? `: ${type}` : "");
  cast = (value: string) => (this.isTypeScript ? `(${value} as any)` : value);
  upTo = (count: number) => Array.from({ length: Math.max(count, 0) }, (_, index) => index);
  emit = (...lines: string[]) => void this.lines.push(...lines);
  next = () => `${this.tag}${++this.count}`;

  /** A size next to a border that is no larger than `most`. Small borders are drawn more often: they cost less to build. */
  size(most: number, least = 1) {
    if (this.only !== undefined) return Math.max(least, this.only);
    const within = borders.filter(border => border <= most);
    const border = within[Math.min(this.below(within.length), this.below(within.length + 2))] ?? within[0];
    return Math.max(least, border + this.pick([-1, 0, 0, 1, 1, 2]));
  }
  place = (size: number) => this.pick([0, size - 1, size >> 1, this.below(Math.max(size, 1))]);
  oddNumber = () =>
    this.pick(["1.5", "-0", "NaN", "2147483648", "-2147483649", "Infinity", "4294967296", "0.1", "-1", "1e21"]);
  odd = () =>
    this.cast(
      this.pick([
        this.oddNumber(),
        this.oddNumber(),
        '"1"',
        '""',
        "null",
        "undefined",
        "true",
        "1n",
        "{ valueOf() { return 1; } }",
        "[]",
        "[2]",
        "{}",
      ]),
    );

  switchOnNumbers() {
    const n = this.next();
    const size = this.size(this.plainly(90, 256, () => 1024));
    const first = this.plainly(60, 0, () => this.pick([1, -3, 100, 2147483640 - size, -2147483648]));
    const stride = this.plainly(70, 1, () => this.pick([2, 3, 10, 1000]));
    const gives = this.pick([(at: number) => `"c${at}"`, (at: number) => String(at * 3 + 1)]);
    const falls = this.plainly(70, -1, () => this.place(size));
    const middle = this.plainly(70, -1, () => this.place(size));
    const subject = this.plainly(70, "x", () => this.pick(["x | 0", "x >>> 0", "+x", "x + 1", "x % 64"]));
    this.emit(
      `function kind${n}(x${this.typed(this.plainly(50, "number", () => "any"))}) {`,
      `  switch (${subject}) {`,
    );
    for (const at of this.upTo(size)) {
      if (at === middle) this.emit(`    default: return ${gives(-1)};`);
      this.emit(`    case ${first + at * stride}:${at === falls ? "" : ` return ${gives(at)};`}`);
    }
    if (middle < 0 && this.chance(80)) this.emit(`    default: return ${gives(-2)};`);
    this.emit(`  }`, `  return ${gives(-3)};`, `}`, `{`, `  let out = "";`);
    this.emit(
      `  for (let i = ${first - 2 * stride}; i < ${first + (size + 2) * stride}; i += ${this.pick([stride, 1, stride * 7])}) out += kind${n}(i);`,
      `  printValue("switch ${n}", out.length, out.slice(0, 40), kind${n}(${this.odd()}), kind${n}(${first}), kind${n}(${this.odd()}), kind${n}(${first + (size - 1) * stride}));`,
      `}`,
    );
  }

  switchOnTexts() {
    const n = this.next();
    const size = this.size(this.plainly(85, 64, () => 256));
    const name = this.pick([
      (at: number) => `k${at}`,
      (at: number) => String.fromCharCode(97 + (at % 26)) + (at >= 26 ? String(Math.floor(at / 26)) : ""),
      (at: number) => `key-${String(at).padStart(4, "0")}`,
      (at: number) => "a".repeat(at),
      (at: number) => `é${at}`,
    ]);
    this.emit(`function word${n}(x${this.typed(this.plainly(50, "string", () => "any"))}) {`, `  switch (x) {`);
    for (const at of this.upTo(size)) this.emit(`    case ${JSON.stringify(name(at))}: return ${at};`);
    this.emit(`  }`, `  return -1;`, `}`, `{`, `  let sum = 0;`);
    this.emit(
      `  const names${this.typed("string[]")} = ${JSON.stringify(this.upTo(Math.min(size + 1, 40)).map(name))};`,
      `  for (const each of names) sum += word${n}(each) + word${n}(each + "") + word${n}(each.slice(0, 1) + each.slice(1)) + word${n}(each + "x");`,
      `  printValue("texts ${n}", sum, word${n}(${this.odd()}), word${n}(${this.cast(`new String(${JSON.stringify(name(0))})`)}), word${n}(${JSON.stringify(name(size - 1))}), word${n}(${JSON.stringify(name(size))}));`,
      `}`,
    );
  }

  divisions() {
    const n = this.next();
    const divisor = () =>
      this.pick([
        "2",
        "3",
        "7",
        "8",
        "10",
        "16",
        "255",
        "256",
        "1000",
        "65536",
        "2147483647",
        "-1",
        "1",
        "-8",
        "-3",
        "0",
        "-2147483648",
      ]);
    const form = () =>
      this.pick([
        (d: string) => `(x / ${d}) | 0`,
        (d: string) => `x % ${d}`,
        (d: string) => `Math.floor(x / ${d})`,
        (d: string) => `Math.trunc(x / ${d})`,
        (d: string) => `(x / ${d}) >>> 0`,
        (d: string) => `~~(x / ${d})`,
        (d: string) => `Math.round(x / ${d})`,
        (d: string) => `Math.ceil(x / ${d})`,
        (d: string) => `((x | 0) / ${d}) | 0`,
        (d: string) => `(x | 0) % ${d}`,
        (d: string) => `(x >>> 0) % ${d}`,
        (d: string) => `((x >>> 0) / ${d}) | 0`,
      ])(divisor());
    const forms = this.upTo(1 + this.below(4)).map(form);
    this.emit(
      `function part${n}(x${this.typed("number")}) {`,
      `  return [${forms.join(", ")}];`,
      `}`,
      `{`,
      `  const seen = [];`,
    );
    this.emit(
      `  for (let i = -20; i < 20; i++) seen.push(part${n}(i).join());`,
      `  for (const each of [2147483647, -2147483648, 2147483646, -2147483647, 65535, 65536, -65536, 1000000007, ${this.oddNumber()}]) seen.push(part${n}(each).map(value => Object.is(value, -0) ? "-0" : String(value)).join());`,
      `  printValue("divisions ${n}", seen.join(" "));`,
      `}`,
    );
  }

  listLiteral() {
    const n = this.next();
    const size = this.size(this.plainly(85, 128, () => 1024));
    const kind = this.pick([
      (at: number) => String(at),
      (at: number) => String(at),
      (at: number) => `${at}.5`,
      (at: number) => `"t${at}"`,
      (at: number) => `{ id: ${at} }`,
      (at: number) => `p + ${at}`,
      (at: number) => `[${at}]`,
    ]);
    const cells = this.upTo(size).map(kind);
    const at = this.place(size);
    cells[at] = this.plainly(25, cells[at], () =>
      this.pick(["", "...extra", this.odd(), this.odd(), "bump()", "-0", "p++", "(p = 9)", `...${this.cast('"ab"')}`]),
    );
    const any = this.typed("any");
    const use = this.pick([
      `let sum${any} = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum;`,
      `return list.join("|");`,
      `return [list.length, list[${at}], list[${size - 1}], list[${size}], ${at} in list];`,
      `return list;`,
      `const [a, b, ...rest] = list; return [a, b, rest.length];`,
      `return list.indexOf(${this.cast(kind(at))}) + "," + list.includes(${this.cast("NaN")}) + "," + list.lastIndexOf(${this.cast(kind(0))});`,
      `list[${at}] = ${this.odd()}; list.length = ${this.pick([size, size - 1, size + 1, 0])}; return list.map(String).join();`,
      `return list.map(each => typeof each).join("").length + ":" + JSON.stringify(list).length;`,
      `let sum${any} = 0; for (const each of list) sum += each; return sum;`,
      `return Math.max(...list);`,
    ]);
    this.emit(
      `function list${n}(p${any}) {`,
      `  const extra${this.typed("any[]")} = [7, 8];`,
      `  const bump = () => { p += 100; return p; };`,
      `  const list${this.typed("any[]")} = [${cells.join(", ")}];`,
      `  ${use}`,
      `}`,
      `printValue("list ${n}", String(list${n}(1)), String(list${n}(${this.plainly(60, "2", () => this.odd())})));`,
    );
  }

  literalArgument() {
    const n = this.next();
    const size = this.size(16);
    const names = this.upTo(size).map(at => `a${at}`);
    const any = this.typed("any");
    const at = this.place(size);
    const members = names.map(
      (name, index) => `${name}: ${this.pick([`i + ${index}`, String(index), `"s${index}"`, `i * ${index}.5`])}`,
    );
    const oddly = [...members];
    oddly[at] = this.pick([
      `get ${names[at]}() { seen${n}++; return 5; }`,
      `b${at}: 1`,
      `...more${n}`,
      `__proto__: more${n}`,
      `["${names[at]}"]: 3`,
      `${names[at]}: undefined`,
      `${names[at]}: ${this.odd()}`,
      ...(this.isTypeScript ? [] : [`${names[at]}: 1, ${names[0]}: 2`]),
    ]);
    const pattern = names.map((name, index) =>
      index === at && this.chance(30) ? `${name} = ${this.pick(["7", `${names[0]}`, `seen${n}++`])}` : name,
    );
    const sum = names.join(" + ");
    const head = this.pick([
      [`function take${n}({ ${pattern.join(", ")} }${any}) {`, `  return ${sum};`],
      [`function take${n}(o${any}) {`, `  return ${names.map(name => `o.${name}`).join(" + ")};`],
      [`function take${n}(o${any}) {`, `  const { ${pattern.join(", ")} } = o;`, `  return ${sum};`],
      [`function take${n}({ ${names[0]}, ...rest }${any}) {`, `  return ${names[0]} + ":" + Object.keys(rest).join();`],
      [
        `function take${n}(o${any}) {`,
        `  if (o.${names[at]} === undefined) kept${n}.push(o);`,
        `  return ${names.map(name => `o.${name}`).join(" + ")};`,
      ],
    ]);
    this.emit(
      `let seen${n} = 0;`,
      `const kept${n}${this.typed("any[]")} = [];`,
      `const more${n} = { ${names[at]}: 40, z: 41 };`,
      ...head,
      `}`,
      `{`,
      `  let out${any} = "";`,
      `  for (let i = 0; i < ${this.pick([3, 50, 2000])}; i++) out = take${n}({ ${members.join(", ")} });`,
      `  const i = 1;`,
      `  printValue("argument ${n}", out, take${n}({ ${oddly.join(", ")} }), seen${n}, kept${n}.length);`,
      `}`,
    );
  }

  restHandedOn() {
    const n = this.next();
    const size = this.size(32, 0);
    const any = this.typed("any");
    const rest = `...rest${this.typed("any[]")}`;
    const inner = this.pick([
      `rest.push(a); rest[0] = "changed"; return rest.length + ":" + rest.join();`,
      `let sum = a; for (let i = 0; i < rest.length; i++) sum += rest[i]; return sum;`,
      `kept${n}.push(rest); return rest.length;`,
      `return arguments.length + ":" + rest.length;`,
      `return rest;`,
    ]);
    const outer = this.pick([
      `return inner${n}(1, ...args);`,
      `const got = inner${n}(1, ...args); return [got, args.length, args[0]].join();`,
      `const one = inner${n}(1, ...args); const two = inner${n}(2, ...args); return [one === two, String(one), String(two), args.join()].join(";");`,
      `kept${n}.push(args); return inner${n}(1, ...args);`,
      `return ${this.cast(`inner${n}`)}(...args);`,
      `return inner${n}(1, ...args, 2);`,
      `args.length = ${this.pick([0, 1, size + 1])}; return inner${n}(1, ...args);`,
      `return inner${n}.apply(null, ${this.cast("args")});`,
      `return inner${n}(1, ...args.slice(1));`,
    ]);
    const values = this.upTo(size).map(at => (at === this.place(size) && this.chance(40) ? this.odd() : String(at)));
    this.emit(
      `const kept${n}${this.typed("any[]")} = [];`,
      `function inner${n}(a${any}, ${rest})${any} { ${inner} }`,
      `function outer${n}(...args${this.typed("any[]")})${any} { ${outer} }`,
      `printValue("rest ${n}", String(outer${n}(${values.join(", ")})), String(outer${n}()), String(outer${n}(${this.odd()})), JSON.stringify(kept${n}));`,
    );
  }

  countedGrowth() {
    const n = this.next();
    const bound = this.plainly(50, String(this.size(4096, 0)), () =>
      this.pick(["100000", "100001", "0", "-1", "1.5", "NaN", this.cast('"5"'), "70000"]),
    );
    const any = this.typed("any");
    const [make, add, read] = this.pick([
      [`[]`, `into.push(i * 2)`, `into.length + ":" + into[into.length - 1]`],
      [`[]`, `into.push(i, i + 0.5)`, `into.length + ":" + into[into.length - 1]`],
      [`[]`, `into[i] = i`, `into.length + ":" + into[into.length >> 1]`],
      [`[]`, `into[into.length] = "t" + i`, `into.length + ":" + into[into.length - 1]`],
      [`new Map()`, `into.set(i, i)`, `into.size + ":" + into.get(3)`],
      [`new Map()`, `into.set("k" + i, i)`, `into.size + ":" + into.get("k3")`],
      [
        `new Map()`,
        `into.set(i % 7 ? i : ${this.pick(["NaN", "-0", "0", "null"])}, i)`,
        `into.size + ":" + [...into.keys()].slice(0, 3).map(key => Object.is(key, -0) ? "-0" : String(key)).join()`,
      ],
      [`new Set()`, `into.add(i)`, `into.size + ":" + into.has(3)`],
      [`new Set()`, `into.add(i % 5 ? i : ${this.pick(["NaN", "-0", "0", '"0"'])})`, `into.size + ":" + into.has(0)`],
      [`{}`, `into["k" + i] = i`, `Object.keys(into).length + ":" + into.k3`],
      [`{}`, `into[i] = i`, `Object.keys(into).length + ":" + into[3]`],
      [`""`, `into += i`, `into.length + ":" + into.slice(-4)`],
      [`""`, `into += String.fromCharCode(65 + (i % 26))`, `into.length + ":" + into.slice(-4)`],
    ]);
    const inTheLoop = this.plainly(60, "", () =>
      this.pick([
        `if (i === 5) break; `,
        `if (i === 5) continue; `,
        `if (i === 5) count = 9; `,
        `if (i === 5) i += 2; `,
        `if (i === 5) into = ${make}; `,
      ]),
    );
    this.emit(
      `function fill${n}(count${any}) {`,
      `  let into${any} = ${make};`,
      `  for (let i = 0; i < count; i++) { ${inTheLoop}${add}; }`,
      `  return ${read};`,
      `}`,
      `printValue("growth ${n}", fill${n}(${bound}), fill${n}(${this.pick(["3", "8", "9", "0"])}));`,
    );
  }

  awaits() {
    const n = this.next();
    const any = this.typed("any");
    const answer = () =>
      this.pick([
        `return x + 1;`,
        `return x + 1;`,
        `throw new RangeError("r" + x);`,
        `return ${this.cast(`{ then(resolve${any}) { order${n} += "t"; resolve(x + 2); } }`)};`,
        `return Promise.resolve(x + 3);`,
        `return Promise.reject(new TypeError("j" + x));`,
        `await null; return x + 4;`,
        `if (x > 1) throw x; return x;`,
        `return ${this.cast("{ then: 5, x }")};`,
        `return;`,
      ]);
    const isAsync = this.plainly(75, "async ", () => "");
    const promised = this.typed("Promise<any>");
    const size = this.size(16);
    const body = this.pick([
      [`const got = await one${n}(x);`, `order${n} += "a";`, `return got;`],
      [`const got = x > 1 ? await one${n}(x) : two${n}(x);`, `order${n} += "b";`, `return got;`],
      [`const waits = x > 1 ? one${n}(x) : two${n}(x);`, `order${n} += "c";`, `return await waits;`],
      [
        `let got${any};`,
        `if (x > 1) got = one${n}(x); else got = two${n}(x);`,
        `got = await got;`,
        `order${n} += "d";`,
        `return got;`,
      ],
      [`return (await one${n}(x)) + (await two${n}(x));`],
      [
        `try { return await one${n}(x); } catch (error) { order${n} += "e"; return await two${n}(x); } finally { order${n} += "f"; }`,
      ],
      [`let sum${any} = 0;`, ...this.upTo(size).map(at => `sum += await one${n}(x + ${at});`), `return sum;`],
      [
        `let sum${any} = 0;`,
        `for (let i = 0; i < ${size}; i++) sum += await (i % 2 ? one${n}(i) : two${n}(i));`,
        `return sum;`,
      ],
      [`const [a, b] = await Promise.all([one${n}(x), two${n}(x)]);`, `return a + b;`],
      [`for await (const each of [one${n}(x), two${n}(x), 3]) order${n} += String(each);`, `return 0;`],
    ]);
    this.emit(
      `let order${n} = "";`,
      `${isAsync}function one${n}(x${any})${isAsync ? promised : any} { order${n} += "1"; ${answer().replace(/^await null; /, "")} }`,
      `async function two${n}(x${any})${promised} { order${n} += "2"; ${answer()} }`,
      `async function both${n}(x${any})${promised} {`,
      ...body.map(line => "  " + line),
      `}`,
      `{`,
      `  const said = [];`,
      `  for (const x of [1, 2, ${this.odd()}]) {`,
      `    const waits = both${n}(x).then(value => "got " + String(value?.x ?? value), error => "threw " + String(error?.message ?? error));`,
      `    order${n} += "|";`,
      `    said.push(await waits);`,
      `  }`,
      `  printValue("awaits ${n}", said.join(), order${n});`,
      `}`,
    );
  }

  classesWithOneMethod() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 16, () => 128),
      2,
    );
    const any = this.typed("any");
    const below = this.chance(50);
    if (below) this.emit(`class Base${n} { w = 1; area()${any} { return -this.w; } name() { return "base"; } }`);
    for (const at of this.upTo(size))
      this.emit(
        `class Shape${n}_${at}${below ? ` extends Base${n}` : ""} { ${below ? "" : "w = 1; "}s${at % 3} = ${at}; ${below && at % 4 === 3 ? "" : `area()${any} { return this.w * ${at} + this.s${at % 3}; } `}}`,
      );
    const oddOne = this.pick([
      `{ w: 2, area() { return "own"; } }`,
      `Object.assign(new Shape${n}_0(), { area: () => "assigned" })`,
      `Object.create(Shape${n}_1.prototype)`,
      `Object.setPrototypeOf(new Shape${n}_0(), Shape${n}_1.prototype)`,
      `{ w: 2, area: Math.abs }`,
      `new Proxy(new Shape${n}_0(), {})`,
      `new (class extends Shape${n}_1 { area()${any} { return "heir " + super.area(); } })()`,
      `new Shape${n}_0()`,
    ]);
    const change = this.plainly(50, "", () =>
      this.pick([
        `${this.cast(`Shape${n}_1.prototype`)}.area = function () { return "replaced"; };`,
        `delete ${this.cast(`Shape${n}_1.prototype`)}.area;`,
        `Object.defineProperty(Shape${n}_1.prototype, "area", { get() { return () => "got"; } });`,
        `Object.setPrototypeOf(Shape${n}_1.prototype, { area() { return "above"; } }); delete ${this.cast(`Shape${n}_1.prototype`)}.area;`,
        `${this.cast("all[1]")}.area = () => "own now";`,
      ]),
    );
    this.emit(
      `{`,
      `  const all${this.typed("any[]")} = [${this.upTo(size)
        .map(at => `new Shape${n}_${at}()`)
        .join(", ")}];`,
      `  const total = () => { let out = ""; for (const each of all) out += each.area() + ","; return out; };`,
      `  let first = ""; for (let turn = 0; turn < ${this.pick([1, 3, 200])}; turn++) first = total();`,
      `  all.push(${oddOne});`,
      `  ${change}`,
      `  let second = ""; try { second = total(); } catch (error) { second = "threw " + (error${this.isTypeScript ? " as any" : ""})?.constructor?.name; }`,
      `  printValue("classes ${n}", first.length, first.slice(0, 60), second.length, second.slice(-40));`,
      `}`,
    );
  }

  keysFromParts() {
    const n = this.next();
    const size = this.size(12, 2);
    const any = this.typed("any");
    const part = (at: number) =>
      this.pick([`a`, `b`, `"-"`, `":"`, `i`, `(i % 3)`, `"p${at}"`, `a.slice(1)`, "`${b}`"]);
    const key = this.upTo(size).map(part).join(" + ");
    const [make, put, get] = this.pick([
      [`new Map()`, (k: string, v: string) => `table.set(${k}, ${v})`, (k: string) => `table.get(${k})`],
      [`{}`, (k: string, v: string) => `table[${k}] = ${v}`, (k: string) => `table[${k}]`],
      [`Object.create(null)`, (k: string, v: string) => `table[${k}] = ${v}`, (k: string) => `table[${k}]`],
      [`new Set()`, (k: string, _: string) => `table.add(${k})`, (k: string) => `table.has(${k})`],
    ] as const);
    const through = this.chance(40);
    if (through) this.emit(`const keyOf${n} = (a${any}, b${any}, i${any}) => "" + ${key};`);
    const k = through ? `keyOf${n}(a, b, i)` : `"" + ${key}`;
    this.emit(
      `function look${n}(a${any}, b${any}) {`,
      `  const table${any} = ${make};`,
      `  for (let i = 0; i < ${this.pick([4, 40, 400])}; i++) ${put(k, "i")};`,
      `  let found${any} = 0;`,
      `  for (let i = ${this.pick([0, -1, 2])}; i < 6; i++) found += ${get(k)} ?? -100;`,
      `  return found;`,
      `}`,
      `printValue("keys ${n}", look${n}("xy", "z"), look${n}("", ""), look${n}(${this.cast(this.pick(['"é"', '"x".repeat(70)', '"length"', '"__proto__"', '"0"']))}, ${this.pick(['"w"', this.cast("1"), this.cast("-0"), this.cast("null"), this.cast("1.5"), this.cast("[1, 2]")])}));`,
    );
  }

  patternsFromTexts() {
    const n = this.next();
    const size = this.size(this.plainly(85, 8, () => 96));
    const any = this.typed("any");
    const piece = () =>
      this.pick([
        "a",
        "b+",
        "[a-c]",
        "\\\\d",
        "(x|y)",
        ".",
        "^a",
        "c$",
        "\\\\b",
        "(?:ab)*",
        "a{2}",
        "é",
        "\\\\s*",
        "(?<w>a)",
        "a?",
      ]);
    const texts = this.upTo(size).map(() => `"${piece()}${piece()}"`);
    if (this.chance(25))
      texts[this.place(size)] = this.pick(['"("', '"["', '"a{2,1}"', '""', '"\\\\"', '"(?<a>.)(?<a>.)"', '"*"']);
    const flags = this.plainly(
      50,
      "",
      () => `, ${this.pick(['"g"', '"i"', '"gi"', '"u"', '"y"', '"v"', '"s"', '"m"', '"d"', '"gg"', '"x"'])}`,
    );
    const made = this.pick([
      `new RegExp(text${flags})`,
      `new RegExp(text${flags})`,
      `RegExp(text${flags})`,
      `new RegExp("^" + text + "$"${flags})`,
      `new RegExp(text + "|" + text${flags})`,
      `new RegExp("(" + text + ")"${flags})`,
    ]);
    const use = this.pick([
      `pattern.test(subject)`,
      `String(pattern.exec(subject))`,
      `subject.replace(pattern, "<$&>")`,
      `subject.split(pattern).length`,
      `String(subject.match(pattern))`,
      `subject.search(pattern)`,
      `pattern.source + "/" + pattern.flags + pattern.lastIndex`,
    ]);
    this.emit(
      `{`,
      `  const texts = [${texts.join(", ")}];`,
      `  const subject = ${this.pick(['"aab xy 12 abc"', '"abcabc"', '""', '"éa b"', '"a\\nb"'])};`,
      `  let out = "";`,
      `  for (const text of texts) {`,
      `    try { const pattern${any} = ${made}; out += ${use} + ";"; } catch (error) { out += (error${this.isTypeScript ? " as any" : ""}).name + ";"; }`,
      `  }`,
      `  printValue("patterns ${n}", out.length, out.slice(0, 120));`,
      `}`,
    );
  }

  deepPattern() {
    const n = this.next();
    const depth = this.size(512);
    const [open, close] = this.pick([
      ["(", ")"],
      ["(?:", ")"],
      ["(?:", ")?"],
      ["(", ")*"],
      ["(?=", ")"],
      ["(a|", ")"],
    ]);
    this.emit(
      `{`,
      `  const pattern = /${open.repeat(depth)}a${close.repeat(depth)}/;`,
      `  const found = pattern.exec("${this.pick(["a", "aa", "b", ""])}");`,
      `  printValue("deep pattern ${n}", found === null ? "none" : found.length + ":" + found[0] + ":" + found[found.length - 1], pattern.source.length);`,
      `}`,
    );
  }

  modules() {
    const n = this.next();
    const size = this.size(this.plainly(90, 12, () => 32));
    const kind = this.pick(["barrel", "barrel", "json", "json", "require", "require", "text"]);
    if (kind === "barrel") {
      for (const at of this.upTo(size))
        this.files.push([
          `./part-${n}-${at}.${this.isTypeScript ? "ts" : "js"}`,
          `export const v${at} = ${at};\n${at === this.place(size) && this.chance(40) ? `console.log("part ${at} runs");\n` : ""}export function f${at}() { return v${at} + 1; }\n`,
        ]);
      this.files.push([
        `./barrel-${n}.${this.isTypeScript ? "ts" : "js"}`,
        this.upTo(size)
          .map(at =>
            this.pick([
              `export * from "./part-${n}-${at}";`,
              `export { v${at}, f${at} } from "./part-${n}-${at}";`,
              `export * from "./part-${n}-${at}";`,
            ]),
          )
          .join("\n") + "\n",
      ]);
      const at = this.place(size);
      this.imports.push(
        this.pick([
          `import { v${at} as v${n}, f${at} as f${n} } from "./barrel-${n}";`,
          `import * as all${n} from "./barrel-${n}";\nconst { v${at}: v${n}, f${at}: f${n} } = all${n};`,
        ]),
      );
      this.emit(`printValue("barrel ${n}", v${n}, f${n}());`);
    } else if (kind === "json") {
      const value = this.pick([
        () =>
          `{${this.upTo(size)
            .map(
              at =>
                `"k${at}": ${this.pick([String(at), `"t${at}"`, `[${at}]`, `{"in": ${at}}`, "null", "1.5", "true"])}`,
            )
            .join(", ")}}`,
        () =>
          `[${this.upTo(size)
            .map(at => this.pick([String(at), String(at), `${at}.5`, `"t"`, "null", `{"a": ${at}}`]))
            .join(", ")}]`,
        () => this.pick(["3", '"text"', "null", "[]", "{}", '{"default": 1, "__proto__": {"x": 2}, "length": 3}']),
      ])();
      this.files.push([`./data-${n}.json`, value + "\n"]);
      this.imports.push(
        this.pick([
          `import data${n} from "./data-${n}.json";`,
          `import data${n} from "./data-${n}.json" with { type: "json" };`,
          `import * as space${n} from "./data-${n}.json";\nconst data${n} = space${n}.default;`,
        ]),
      );
      this.emit(
        `{`,
        `  const data${this.typed("any")} = data${n};`,
        `  const before = JSON.stringify(data);`,
        `  ${this.pick([`if (data && typeof data === "object") data.added = 1;`, `if (Array.isArray(data)) data.push(${this.odd()});`, `if (data && typeof data === "object") delete data[Object.keys(data)[0]];`, ``, ``])}`,
        `  printValue("data ${n}", before.length, before.slice(0, 60), JSON.stringify(data).length, data?.k1, data?.[1], Object.isFrozen(data));`,
        `}`,
      );
    } else if (kind === "text") {
      this.files.push([`./words-${n}.txt`, this.pick(["", "one\ntwo\n", "é\u0000x", "a".repeat(size * 100)])]);
      this.imports.push(`import words${n} from "./words-${n}.txt"${this.chance(50) ? ' with { type: "text" }' : ""};`);
      this.emit(
        `printValue("words ${n}", typeof words${n}, ${this.cast(`words${n}`)}.length, ${this.cast(`words${n}`)}.slice(0, 9));`,
      );
    } else {
      this.files.push([
        `./old-${n}.cjs`,
        this.pick([
          `exports.a = 1;\nexports.b = function () { return exports.a + 1; };\n`,
          `module.exports = { a: 1, b() { return this.a + 1; } };\n`,
          `module.exports = function b() { return 2; };\nmodule.exports.a = 1;\nmodule.exports.b = module.exports;\n`,
          `const path = require("node:path");\nexports.a = path.sep.length;\nexports.b = () => path.basename("/x/y.js");\n`,
          `Object.defineProperty(exports, "a", { enumerable: true, get() { return 1; } });\nexports.b = () => require("./old-${n}.cjs").a;\n`,
          `exports.a = typeof module + typeof require + typeof __filename;\nexports.b = () => this === exports;\n`,
        ]),
      ]);
      this.imports.push(
        this.pick([
          `import { createRequire } from "node:module";\nconst old${n} = createRequire(import.meta.url)("./old-${n}.cjs");`,
          `import old${n} from "./old-${n}.cjs";`,
          `import * as old${n} from "./old-${n}.cjs";`,
          `const old${n} = require("./old-${n}.cjs");`,
        ]),
      );
      this.emit(
        `printValue("required ${n}", ${this.cast(`old${n}`)}.a, ${this.cast(`old${n}`)}.b(), Object.keys(old${n}).join());`,
      );
    }
  }

  namesHandedToALoader() {
    const n = this.next();
    const depth = this.size(8);
    const any = this.typed("any");
    const name = this.pick(['"node:path"', '"path"', '"node:os"', '"node:util"', '"node:events"', '"node:url"']);
    const load = this.pick([
      (x: string) => `require(${x})`,
      (x: string) => `await import(${x})`,
      (x: string) => `process.getBuiltinModule(${x})`,
    ]);
    if (this.chance(50)) {
      this.emit(`{`, `  const name0 = ${name};`);
      for (const at of this.upTo(depth)) this.emit(`  const name${at + 1} = name${at};`);
      this.emit(
        `  const loaded${any} = ${load(`name${depth}`)};`,
        `  printValue("loaded ${n}", typeof loaded, Object.keys(loaded).length > 3);`,
        `}`,
      );
    } else {
      const isAsync = load("x").startsWith("await");
      this.emit(
        `${isAsync ? "async " : ""}function load${n}_0(name${any})${isAsync ? this.typed("Promise<any>") : any} { return ${load("name")}; }`,
      );
      for (const at of this.upTo(depth))
        this.emit(`function load${n}_${at + 1}(name${any})${any} { return load${n}_${at}(name); }`);
      this.emit(
        `{`,
        `  const loaded${any} = await load${n}_${depth}(${name});`,
        `  printValue("loaded ${n}", typeof loaded, Object.keys(loaded).length > 3);`,
        `}`,
      );
    }
  }

  kindsToldApartByATag() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 12, () => 96),
      2,
    );
    const tag = this.pick(["kind", "type", "tag", "t"]);
    const width = this.pick([2, 3, 4, 30]);
    const tagOf = this.pick([
      (at: number) => `"k${at}"`,
      (at: number) => `"k${at}"`,
      (at: number) => String(at),
      (at: number) => (at < 2 ? String(at === 0) : `"k${at}"`),
      (at: number) => `"kind-${String(at).padStart(width, "0")}"`,
    ]);
    if (this.isTypeScript) {
      for (const at of this.upTo(size))
        this.emit(
          `type Kind${n}_${at} = { ${tag}: ${tagOf(at)}; f${at % 4}: number${at % 3 === 0 ? "; extra?: string" : ""} };`,
        );
      this.emit(
        `type Any${n} = ${this.upTo(size)
          .map(at => `Kind${n}_${at}`)
          .join(" | ")};`,
      );
    }
    const how = this.pick(["switch", "switch", "if", "table"]);
    this.emit(`function weigh${n}(one${this.typed(`Any${n}`)})${this.typed("number")} {`);
    if (how === "switch") {
      this.emit(`  switch (one.${tag}) {`);
      for (const at of this.upTo(size)) this.emit(`    case ${tagOf(at)}: return one.f${at % 4} + ${at};`);
      this.emit(`  }`, `  return -1;`);
    } else if (how === "if") {
      for (const at of this.upTo(size)) this.emit(`  if (one.${tag} === ${tagOf(at)}) return one.f${at % 4} + ${at};`);
      this.emit(`  return -1;`);
    } else
      this.emit(
        `  return ${this.cast("one")}["f" + (${this.cast(`[${this.upTo(size).map(tagOf).join(", ")}]`)}.indexOf(one.${tag}) % 4)];`,
      );
    const at = this.place(size);
    const liar = this.pick([
      `{ ${tag}: ${tagOf(at)} }`,
      `{ ${tag}: ${tagOf(at)}, f${(at + 1) % 4}: 5 }`,
      `{ ${tag}: "none", f0: 5 }`,
      `{ f${at % 4}: 5, ${tag}: ${tagOf(at)} }`,
      `{ ${tag}: ${tagOf(at)}, f${at % 4}: "text" }`,
      `{ ${tag}: ${tagOf(at)}, f${at % 4}: 1.5, extra: 1, more: 2 }`,
      `JSON.parse('{"${tag}": ${tagOf(at).replace(/"/g, '\\"')}, "f${at % 4}": 7}')`,
      `Object.create({ ${tag}: ${tagOf(at)}, f${at % 4}: 5 })`,
      `{ get ${tag}() { return ${tagOf(at)}; }, f${at % 4}: 5 }`,
    ]);
    this.emit(
      `}`,
      `{`,
      `  const all${this.typed(`Any${n}[]`)} = [${this.upTo(size)
        .map(each => `{ ${tag}: ${tagOf(each)}, f${each % 4}: ${each} }`)
        .join(", ")}];`,
      `  let sum = 0;`,
      `  for (let turn = 0; turn < ${this.pick([1, 100])}; turn++) for (const one of all) sum += weigh${n}(one);`,
      `  printValue("kinds ${n}", sum, weigh${n}(${this.cast(liar)}));`,
      `}`,
    );
  }

  addresses() {
    const n = this.next();
    const text = () =>
      this.pick([
        '"https://example.com/a/b?x=1&y=2#top"',
        '"http://user:pw@host:8080/p"',
        '"file:///tmp/x.txt"',
        '"https://é.example/ü?q=ü"',
        '"/only/a/path"',
        '""',
        '"https://example.com:99999/"',
        '"HTTP://EXAMPLE.COM/../a/./b"',
        '"data:text/plain,hi"',
        '"https://[::1]:3000/x"',
        '"https://example.com/%zz?a=%20"',
      ]);
    const part = () =>
      this.pick([
        "pathname",
        "pathname",
        "search",
        "hash",
        "host",
        "hostname",
        "port",
        "protocol",
        "origin",
        "href",
        "username",
        'searchParams.get("x")',
        "searchParams.size",
        "toString()",
      ]);
    const base = this.plainly(
      70,
      "",
      () => `, ${this.pick(['"https://base.example/dir/"', '"not a base"', "undefined"])}`,
    );
    this.emit(
      `function read${n}(text${this.typed("string")}) {`,
      `  try { ${this.pick([`return new URL(text${base}).${part()};`, `const url = new URL(text${base}); return url.${part()} + "|" + url.${part()};`, `const url = new URL(text${base}); url.${this.pick(["pathname", "search", "hash", "port"])} = "9"; return url.${part()};`, `return URL.canParse(text${base}) + ":" + URL.parse(text${base})?.${part()};`])} } catch (error) { return (error${this.isTypeScript ? " as any" : ""}).name; }`,
      `}`,
      `printValue("addresses ${n}", [${text()}, ${text()}, ${text()}].map(read${n}).join(" "));`,
    );
  }

  textsCompared() {
    const n = this.next();
    const length = this.size(64, 0);
    const letter = this.plainly(80, "a", () => "é");
    const word = letter.repeat(Math.max(length - 1, 0)) + (length ? "z" : "");
    const literal = JSON.stringify(word);
    const test = this.pick([
      `x === ${literal}`,
      `x === ${literal}`,
      `x !== ${literal}`,
      `x == ${literal}`,
      `x.startsWith(${literal})`,
      `x.endsWith(${literal})`,
      `x.includes(${literal})`,
      `x.indexOf(${literal})`,
      `x.lastIndexOf(${literal})`,
      `x < ${literal}`,
      `x >= ${literal}`,
      `x.localeCompare(${literal})`,
      `x.split(${literal}).length`,
      `x.replaceAll(${literal}, "-").length`,
    ]);
    this.emit(
      `function same${n}(x${this.typed(this.plainly(50, "string", () => "any"))}) { return ${test}; }`,
      `{`,
      `  const half = ${JSON.stringify(word.slice(0, length >> 1))};`,
      `  printValue("compared ${n}", same${n}(${literal}), same${n}(half + ${JSON.stringify(word.slice(length >> 1))}), same${n}(${JSON.stringify(word.slice(0, -1))}), same${n}(${literal} + "q"), same${n}(${JSON.stringify(word.slice(0, -1) + "y")}), same${n}(${JSON.stringify(word.replace(/^./, "ā"))}), same${n}(""), same${n}(${this.cast(`new String(${literal})`)}));`,
      `}`,
    );
  }

  textsPutInOrder() {
    const n = this.next();
    const words = this.upTo(this.size(32, 2)).map(at =>
      this.pick([
        "a",
        "ab",
        "abc",
        "b",
        "",
        "A",
        "é",
        "a".repeat(9),
        "aaaaaaaab",
        "10",
        "9",
        "\u{1f600}",
        "￿",
        `w${at}`,
      ]),
    );
    const compare = this.pick([
      `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`,
      `(a, b) => (a < b ? -1 : 1)`,
      `undefined`,
      `(a, b) => a.localeCompare(b)`,
      `(a, b) => (a <= b ? -1 : 1)`,
      `(a, b) => +(a > b) - +(a < b)`,
    ]);
    this.emit(
      `{`,
      `  const words${this.typed("any[]")} = ${JSON.stringify(words)};`,
      `  ${this.plainly(60, "", () => `words[${this.place(words.length)}] = ${this.pick([this.odd(), `"a" + "b".repeat(3)`, `words[0] + words[1]`])};`)}`,
      `  printValue("order ${n}", JSON.stringify(words.slice().sort(${compare}).map(String)), words.filter(each => each > "a" && each <= "b").length, words[0] < words[1], words[0] >= words[1]);`,
      `}`,
    );
  }

  concatenations() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 32, () => 512),
      2,
    );
    const any = this.typed("any");
    const operand = (at: number) =>
      this.pick([`a`, `b`, `","`, `"p${at}"`, `${at}`, `i`, `(a + b)`, "`<${a}>`", `a.length`, `c`]);
    const how = this.pick(["one", "one", "appends", "appends", "branches", "webs", "template", "loop"]);
    this.emit(
      `function text${n}(a${this.typed("string")}, b${this.typed("string")}, c${any}, i${this.typed("number")}) {`,
    );
    if (how === "one")
      this.emit(`  return ${this.plainly(70, '"" + ', () => "")}${this.upTo(size).map(operand).join(" + ")};`);
    else if (how === "template")
      this.emit(
        "  return `" +
          this.upTo(size)
            .map(
              at =>
                "${" +
                operand(at)
                  .replace(/`/g, "'")
                  .replace(/\$\{a\}/, "x") +
                "}",
            )
            .join(this.pick(["", ",", " "])) +
          "`;",
      );
    else if (how === "appends")
      this.emit(`  let out = "";`, ...this.upTo(size).map(at => `  out += ${operand(at)};`), `  return out;`);
    else if (how === "branches")
      this.emit(
        `  let out = "";`,
        ...this.upTo(size).map(at => `  ${at % 2 ? `if (i > ${at}) ` : ""}out += ${operand(at)};`),
        `  return out;`,
      );
    else if (how === "loop")
      this.emit(
        `  let out = "";`,
        `  for (let turn = 0; turn < ${size}; turn++) { out += ${operand(0)}; ${this.plainly(60, "", () => `if (turn === 3) out = out.${this.pick(["slice(1)", "trim()", "toUpperCase()", "concat(c)"])}; `)}out += ${operand(1)}; }`,
        `  return out;`,
      );
    else
      this.emit(
        ...this.upTo(size).map(at => `  let out${at} = "${at}";`),
        `  for (let turn = 0; turn < 5; turn++) { ${this.upTo(size)
          .map(at => `out${at} += ${operand(at)};`)
          .join(" ")} }`,
        `  return [${this.upTo(size)
          .map(at => `out${at}`)
          .join(", ")}].join("/");`,
      );
    this.emit(
      `}`,
      `{`,
      `  const one = text${n}("x", "yz", 1, 2), two = text${n}("", "é", ${this.odd()}, ${this.pick(["1000", "-1", "1.5", "NaN"])});`,
      `  printValue("text ${n}", one.length, one.slice(0, 50), two.length, two.slice(-50));`,
      `}`,
    );
  }

  manyOperands() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 32, () => 512),
      0,
    );
    const any = this.typed("any");
    const at = this.place(size);
    const values = this.upTo(size).map(each =>
      each === at && this.chance(50) ? this.odd() : this.pick([String(each), String(each), `x + ${each}`]),
    );
    const list = values.join(", ");
    const call = this.pick([
      `const list${this.typed("any[]")} = [0]; const length = list.push(${list}); return length + ":" + list.join();`,
      `const list${this.typed("any[]")} = [0]; const length = list.unshift(${list}); return length + ":" + list.join();`,
      `const list${this.typed("any[]")} = [0, 1, 2, 3]; const gone = list.splice(1, ${this.pick([0, 1, 2, 9])}${size ? ", " : ""}${list}); return gone.join() + ":" + list.join();`,
      `return ${this.cast("[0]")}.concat(${values.map(value => this.pick([value, `[${value}]`, `[${value}]`])).join(", ")}).join();`,
      `return Math.max(${list}) + ":" + Math.min(${list});`,
      `return String.fromCharCode(${values.map(value => `65 + ${value}`).join(", ")});`,
      `return own${n}(${list});`,
      `return Array.of(${list}).length + ":" + new Array(${list}).length;`,
      `return ${this.cast('""')}.concat(${list});`,
      `return Math.hypot(${list});`,
      `return new Set([${list}]).size + ":" + Object.keys(Object.assign({}, ${size ? values.map((value, each) => `{ k${each}: ${value} }`).join(", ") : "{}"})).length;`,
      `return own${n}.call(null${size ? ", " : ""}${list});`,
      `return ${this.cast(`own${n}`)}.bind(null${size ? ", " : ""}${list})(1, 2);`,
      `return new Own${n}(${list}).sum;`,
    ]);
    const names = this.upTo(size).map(each => `p${each}`);
    this.emit(
      `function own${n}(${names.map(name => name + any).join(", ")})${any} { return arguments.length + ":" + (${names.length ? names.join(" + ") : "0"}); }`,
      `class Own${n} { sum${any}; constructor(${names.map(name => name + any).join(", ")}) { this.sum = ${names.length ? names.join(" + ") : "0"}; } }`,
      `function call${n}(x${any})${any} { ${call} }`,
      `{`,
      `  let said${any}; try { said = String(call${n}(1)); } catch (error) { said = "threw " + (error${this.isTypeScript ? " as any" : ""})?.constructor?.name; }`,
      `  printValue("operands ${n}", said.length, said.slice(0, 60), said.slice(-30));`,
      `}`,
    );
  }

  searchedLiteral() {
    const n = this.next();
    const size = this.size(64, 0);
    const kind = this.pick([
      (at: number) => String(at),
      (at: number) => `"w${at}"`,
      (at: number) => `${at}.5`,
      (at: number) => (at % 2 ? String(at) : `"w${at}"`),
    ]);
    const cells = this.upTo(size).map(kind);
    if (size && this.chance(40))
      cells[this.place(size)] = this.pick(["NaN", "-0", "0", "null", "undefined", "", '"1"', "1"]);
    const method = this.pick(["includes", "includes", "indexOf", "lastIndexOf"]);
    this.emit(
      `function among${n}(x${this.typed("any")}) { return ${this.cast(`[${cells.join(", ")}]`)}.${method}(x); }`,
      `printValue("among ${n}", [${kind(0)}, ${kind(size - 1)}, ${kind(size)}, NaN, -0, 0, undefined, null, "1", 1, ${this.odd()}].map(among${n}).join());`,
    );
  }

  listsOfALength() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 128, () => 4096),
      0,
    );
    const any = this.typed("any");
    const view = this.pick([
      "Uint8Array",
      "Int32Array",
      "Float64Array",
      "Uint8ClampedArray",
      "Int16Array",
      "Float32Array",
      "BigInt64Array",
      "Uint32Array",
    ]);
    const unit = view.startsWith("Big") ? "n" : "";
    const body = this.pick([
      `const list = new Array(${size}); return list.length + ":" + (0 in list) + ":" + list.join("").length;`,
      `const list = new Array(${size}).fill(${this.pick(["0", "1.5", '"t"', "x", "undefined"])}); return list.length + ":" + list[${size - 1}] + ":" + list[${size}];`,
      `const list = Array.from({ length: ${size} }, (_, at) => at * x); return list.length + ":" + list[${size - 1}];`,
      `const list${this.typed("any[]")} = [${this.upTo(Math.min(size, 70)).join(", ")}]; list.length = ${this.pick([0, 1, size, size + 1])}; list.push(x); return list.join();`,
      `const from = new ${view}(${size}).fill(3${unit}), into = new ${view}(${size + this.pick([0, 0, 1, -1])}); into.set(from); return into.length + ":" + into[${size - 1}];`,
      `const from = new ${view}(${size + 2}).map((_, at) => ${unit ? "BigInt(at)" : "at"}); return from.slice(1, ${size + 1}).join("").length + ":" + from.subarray(${this.pick([0, 1, size])}).length;`,
      `const from = new ${view}(${size + 2}).map((_, at) => ${unit ? "BigInt(at)" : "at"}); from.copyWithin(${this.pick([0, 1, 2])}, ${this.pick([0, 1])}, ${size}); return from.join("").length + ":" + from[${size}];`,
      `const bytes = new Uint8Array(${size}); for (let at = 0; at < ${size}; at++) bytes[at] = at * x; return new TextDecoder("latin1").decode(bytes).length + ":" + bytes[${size - 1}];`,
      `const list = [...new ${view}(${size})]; return list.length + ":" + typeof list[0];`,
      `return "ab".repeat(${size}).length + ":" + "x".padStart(${size}, "yz").slice(0, 5) + ":" + "x".padEnd(${size}).length;`,
    ]);
    this.emit(
      `function made${n}(x${any})${any} { ${body} }`,
      `{`,
      `  const said = [1, ${this.odd()}].map(x => { try { return made${n}(x); } catch (error) { return "threw " + (error${this.isTypeScript ? " as any" : ""})?.constructor?.name; } });`,
      `  printValue("length ${n}", said.join(" ").slice(0, 200));`,
      `}`,
    );
  }

  listTakenApart() {
    const n = this.next();
    const size = this.size(32);
    const any = this.typed("any");
    const names = this.upTo(size).map(at => `e${at}`);
    const at = this.place(size);
    const pattern = names.map((name, each) =>
      each === at
        ? this.pick([name, `${name} = 7`, ``, `[${name}] = [1]`, `{ length: ${name} } = "ab"`, `...${name}`])
        : name,
    );
    const cut = pattern.findIndex(each => each.startsWith("..."));
    const shown = (cut < 0 ? pattern : pattern.slice(0, cut + 1)).join(", ");
    const bound = names.filter((_, each) => (cut < 0 || each <= cut) && pattern[each] !== "");
    const source = () =>
      this.pick([
        `[${this.upTo(size).join(", ")}]`,
        `[${this.upTo(size).join(", ")}]`,
        `[${this.upTo(Math.max(size - 1, 0)).join(", ")}]`,
        `[${this.upTo(size + 1).join(", ")}]`,
        `"${"abcdefghij".repeat(4).slice(0, size)}"`,
        `new Set([${this.upTo(size).join(", ")}])`,
        `[${this.upTo(size)
          .map(each => (each === at ? "" : String(each)))
          .join(", ")}${at === size - 1 ? "," : ""}]`,
        `(function* () { for (let i = 0; i < ${size + 2}; i++) { walked${n}++; yield i; } })()`,
        `{ [Symbol.iterator]() { let i = 0; return { next() { walked${n}++; return { done: i > ${size >> 1}, value: i++ }; }, return() { walked${n} += 100; return {}; } }; } }`,
        `new Uint8Array(${size})`,
      ]);
    this.emit(
      `let walked${n} = 0;`,
      this.pick([
        `function apart${n}([${shown}]${any}) {`,
        `function apart${n}(list${any}) {\n  const [${shown}] = list;`,
      ]),
      `  return [${bound.join(", ")}].join();`,
      `}`,
      `printValue("apart ${n}", apart${n}(${source()}), apart${n}(${source()}), walked${n});`,
    );
  }

  capturedVariables() {
    const n = this.next();
    const size = this.size(this.plainly(85, 48, () => 256));
    const any = this.typed("any");
    const names = this.upTo(size).map(at => `c${at}`);
    const at = this.place(size);
    const leaves = this.pick([
      `return read;`,
      `return read;`,
      `kept${n}.push(read); return read;`,
      `return () => read() + 1;`,
      `return [read, write][0];`,
    ]);
    this.emit(
      `const kept${n}${this.typed("any[]")} = [];`,
      `function maker${n}(x${any})${any} {`,
      ...names.map(
        (name, each) => `  ${each === at ? "let" : this.pick(["const", "const", "let"])} ${name}${any} = x + ${each};`,
      ),
      `  const read = () => ${names.join(" + ")};`,
      `  const write = (value${any}) => { ${names[at]} = value; };`,
      `  ${this.plainly(50, "", () => `write(${this.odd()});`)}`,
      `  ${leaves}`,
      `}`,
      `printValue("captured ${n}", String(maker${n}(1)()), String(maker${n}(${this.odd()})()).slice(0, 80));`,
    );
  }

  objectLiteral() {
    const n = this.next();
    const size = this.size(this.plainly(85, 96, () => 4096));
    const any = this.typed("any");
    const at = this.place(size);
    const value = this.pick([
      (each: number) => String(each),
      (each: number) => `x + ${each}`,
      (each: number) => `"v${each}"`,
      (each: number) => `${each}.5`,
      (each: number) => (each % 2 ? String(each) : `"v${each}"`),
    ]);
    const members = this.upTo(size).map(each => `f${each}: ${value(each)}`);
    members[at] = this.plainly(40, members[at], () =>
      this.pick([
        `get f${at}() { return 1; }`,
        `f${at}: ${this.odd()}`,
        `[key]: 1`,
        `${at}: 1`,
        `...more`,
        ...(this.isTypeScript ? [] : [`f${at}: 1, f0: 2`]),
        `__proto__: more`,
        `f${at}() { return 1; }`,
        `"f ${at}": 1`,
        `[Symbol.iterator]: 1`,
      ]),
    );
    const use = this.pick([
      `return one.f0 + one.f${size - 1} + one.f${at};`,
      `return Object.keys(one).length + ":" + Object.keys(one).slice(-2).join();`,
      `let out = ""; for (const name in one) out += name; return out.length + ":" + out.slice(-8);`,
      `let sum${any} = 0; for (const name in one) sum += one[name]; return String(sum).slice(0, 40);`,
      `return JSON.stringify(one).length;`,
      `const copy = { ...one }; return Object.keys(copy).length + ":" + copy.f${at};`,
      `delete one.f${at}; return Object.keys(one).length + ":" + one.f${at} + ":" + one.f${size - 1};`,
      `const { f0, f${size - 1}: last, ...rest } = one; return f0 + ":" + last + ":" + Object.keys(rest).length;`,
      `return Object.values(one).length + ":" + Object.entries(one)[${at}];`,
      `one.added = 1; one.f${at} = ${this.odd()}; return Object.keys(one).pop() + ":" + String(one.f${at});`,
      `return one;`,
      `Object.freeze(one); try { one.f0 = 9; } catch {} return one.f0;`,
      `return Object.assign({ f${at}: "kept", z: 1 }, one).f${at} + ":" + ("f${at}" in one) + ":" + Object.hasOwn(one, "f${at}");`,
    ]);
    this.emit(
      `function record${n}(x${any}, key${any})${any} {`,
      `  const more = { f${at}: "more", m: 1 };`,
      `  const one${any} = { ${members.join(", ")} };`,
      `  ${use}`,
      `}`,
      `{`,
      `  const show = (value${any}) => (typeof value === "object" ? JSON.stringify(value).length : String(value));`,
      `  let last${any}; for (let turn = 0; turn < ${this.pick([1, 3, 300])}; turn++) last = record${n}(turn, "f${at}");`,
      `  printValue("record ${n}", show(last), show(record${n}(${this.odd()}, ${this.pick([`"f0"`, `"other"`, `"__proto__"`, "0", `"f${size}"`])})));`,
      `}`,
    );
  }

  fieldsAddedLater() {
    const n = this.next();
    const size = this.size(this.plainly(85, 128, () => 512));
    const any = this.typed("any");
    const at = this.place(size);
    const start = this.pick([
      `{}`,
      `{}`,
      `{ a: 1 }`,
      `new Start${n}()`,
      `Object.create(null)`,
      `[]`,
      `function () {}`,
      `Object.create({ f${at}: "above" })`,
      `Object.create({ set f${at}(value${any}) { set${n}++; } })`,
    ]);
    const how = this.pick(["lines", "lines", "loop", "define"]);
    this.emit(
      `let set${n} = 0;`,
      `class Start${n} { a = 1; b = 2; }`,
      `function grow${n}(x${any}) {`,
      `  const one${any} = ${start};`,
    );
    if (how === "lines")
      for (const each of this.upTo(size))
        this.emit(
          `  ${each === at && this.chance(40) ? `if (x > 1) ` : ""}one.f${each} = ${this.pick([String(each), `x + ${each}`, `"v"`])};`,
        );
    else if (how === "loop") this.emit(`  for (let i = 0; i < ${size}; i++) one["f" + i] = x + i;`);
    else
      for (const each of this.upTo(size))
        this.emit(
          `  Object.defineProperty(one, "f${each}", { value: ${each}, enumerable: ${each !== at}, writable: true, configurable: true });`,
        );
    this.emit(
      `  return one;`,
      `}`,
      `{`,
      `  const one = grow${n}(1), two = grow${n}(${this.pick(["2", "2", this.odd()])});`,
      `  ${this.plainly(50, "", () => `delete two.f${at};`)}`,
      `  printValue("grown ${n}", Object.keys(one).length, Object.keys(two).length, String(one.f${at}), String(two.f${at}), String(two.f${size - 1}), String(one.f${size}), set${n});`,
      `}`,
    );
  }

  callsHandedDown() {
    const n = this.next();
    const depth = this.size(this.plainly(85, 12, () => 64));
    const any = this.typed("any");
    const bottom = this.pick([
      `x + 1`,
      `x * 2`,
      `[x]`,
      `{ x }`,
      `x.length`,
      `typeof x`,
      `(() => x)`,
      `new Error("e" + x).message`,
      `arguments.length`,
    ]);
    const step = this.pick([
      (at: number) => `down${n}_${at}(x)`,
      (at: number) => `down${n}_${at}(x)`,
      (at: number) => `down${n}_${at}(x, ${at})`,
      (at: number) => `down${n}_${at}(x) ?? ${at}`,
      (at: number) => `down${n}_${at}.call(this, x)`,
      (at: number) => `${this.cast(`down${n}_${at}`)}(...arguments)`,
    ]);
    this.emit(
      `function down${n}_0(${this.isTypeScript ? "this: any, " : ""}x${any}, y${this.isTypeScript ? "?: any" : ""})${any} { return ${bottom}; }`,
    );
    for (const at of this.upTo(depth))
      this.emit(
        `function down${n}_${at + 1}(${this.isTypeScript ? "this: any, " : ""}x${any}, y${this.isTypeScript ? "?: any" : ""})${any} { return ${step(at)}; }`,
      );
    this.emit(
      `{`,
      `  let sum${any} = 0; for (let i = 0; i < ${this.pick([2, 100, 3000])}; i++) sum = down${n}_${depth}(i);`,
      `  const show = (value${any}) => (typeof value === "function" ? "f" + value() : typeof value === "object" ? JSON.stringify(value) : String(value));`,
      `  let odd${any}; try { odd = show(down${n}_${depth}(${this.odd()})); } catch (error) { odd = "threw"; }`,
      `  printValue("down ${n}", show(sum), odd);`,
      `}`,
    );
  }

  shortLoops() {
    const n = this.next();
    const turns = this.size(16, 0);
    const loops = this.size(12);
    const step = this.plainly(70, 1, () => this.pick([2, 3, 1023, 1024, 1025, 4096]));
    const any = this.typed("any");
    const body = (at: number) =>
      this.pick([
        `sum += list[i];`,
        `sum += i * ${at};`,
        `list[i] = sum;`,
        `sum += list[i] * list[i + 1];`,
        `out += i;`,
        `sum += list[i] ?? -1;`,
        `if (list[i] > 2) sum++; else sum--;`,
        `sum = (sum + list[i]) | 0;`,
      ]);
    this.emit(`function turn${n}(list${any}) {`, `  let sum${any} = 0, out = "";`);
    for (const at of this.upTo(loops))
      this.emit(`  for (let i = 0; i < ${turns * step}; i += ${step}) { ${body(at)} }`);
    this.emit(
      `  return sum + ":" + out.length + ":" + list.length;`,
      `}`,
      `printValue("turns ${n}", turn${n}([${this.upTo(turns).join(", ")}]), turn${n}([${this.upTo(Math.max(turns - 1, 0)).join(", ")}]), turn${n}([1.5, ${this.odd()}, , 3]), turn${n}(new Int8Array(${turns})));`,
    );
  }

  loopOverManyLists() {
    const n = this.next();
    const size = this.size(16);
    const any = this.typed("any");
    const names = this.upTo(size).map(at => `l${at}`);
    const holder = this.chance(40);
    const read = (name: string) => (holder ? `all.${name}[i]` : `${name}[i]`);
    this.emit(
      holder
        ? `function walk${n}(all${any}, count${this.typed("number")}) {`
        : `function walk${n}(${names.map(name => name + this.typed(this.plainly(50, "number[]", () => "any"))).join(", ")}, count${this.typed("number")}) {`,
      `  let sum = 0;`,
      `  for (let i = 0; i < count; i++) sum += ${names.map(read).join(" + ")};`,
      `  return sum;`,
      `}`,
      `{`,
      `  const lists${this.typed("any[]")} = [${names.map((_, at) => `[${at}, ${at + 1}, ${at + 2}${at === this.place(size) ? this.pick(["", ", 9", ".5"]) : ""}]`).join(", ")}];`,
      `  ${this.plainly(50, "", () => `lists[${this.place(size)}] = ${this.pick(["[1, 2]", "[1, , 3]", "new Float64Array(3)", '"abc"', "[1, 2, 3.5]", "lists[0]"])};`)}`,
      holder
        ? `  const all = { ${names.map((name, at) => `${name}: lists[${at}]`).join(", ")} };\n  printValue("lists ${n}", walk${n}(all, 3), walk${n}(all, 2), walk${n}(all, 4), walk${n}(all, 0));`
        : `  printValue("lists ${n}", ${this.cast(`walk${n}`)}(...lists, 3), ${this.cast(`walk${n}`)}(...lists, 2), ${this.cast(`walk${n}`)}(...lists, 4), ${this.cast(`walk${n}`)}(...lists, 0));`,
      `}`,
    );
  }

  longSums() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 64, () => 2000),
      2,
    );
    const operator = this.pick([
      "+",
      "+",
      "*",
      "|",
      "^",
      "&",
      "-",
      "&&",
      "||",
      "??",
      ...(this.isTypeScript ? [] : [","]),
    ]);
    const operand = (at: number) => this.pick([`a`, `b`, String(at), `(a | 0)`, `c`, `${at}.5`, `(b >>> 0)`]);
    const whole = this.plainly(60, "", () => this.pick([" | 0", " >>> 0"]));
    this.emit(
      `function sum${n}(a${this.typed("number")}, b${this.typed("number")}, c${this.typed("any")}) { return (${this.upTo(size).map(operand).join(` ${operator} `)})${whole}; }`,
      `printValue("sum ${n}", sum${n}(1, 2, 3), sum${n}(2147483647, -2147483648, 1), sum${n}(0.5, -0, ${this.odd()}), Object.is(sum${n}(-0, -0, -0), -0));`,
    );
  }

  valuesChosen() {
    const n = this.next();
    const size = this.size(32);
    const any = this.typed("any");
    const how = this.pick(["selects", "selects", "chain", "chain", "ifs"]);
    this.emit(`function choose${n}(x${any}, y${any}) {`);
    if (how === "selects")
      this.emit(
        ...this.upTo(size).map(
          at =>
            `  const s${at} = x > ${this.pick([0, at, "y"])} ? ${this.pick([String(at), "x", "y", `${at}.5`, `"t"`])} : ${this.pick([String(-at), "y", "x", "null"])};`,
        ),
        `  return [${this.upTo(size)
          .map(at => `s${at}`)
          .join(", ")}].join();`,
      );
    else if (how === "chain")
      this.emit(
        `  return ${this.upTo(size)
          .map(
            at =>
              `x === ${this.pick([String(at), String(at), String(at * 2), `"${at}"`, String(at + 32), String(at + 64)])}`,
          )
          .join(this.pick([" || ", " || ", " && "]))};`,
      );
    else
      this.emit(
        `  let a${any} = 0, b${any} = 1, c${any} = 2, d${any} = 3;`,
        ...this.upTo(size).map(
          at => `  if (x > ${at}) { a = ${at}; b = x; ${at % 2 ? "c = y; " : ""}${at % 3 ? "d = a; " : ""}}`,
        ),
        `  return [a, b, c, d].join();`,
      );
    this.emit(
      `}`,
      `printValue("chosen ${n}", [0, 1, ${size - 1}, ${size}, ${size + 40}, -1, ${this.odd()}, ${this.odd()}].map(x => choose${n}(x, 2)).join(" ").slice(0, 300));`,
    );
  }

  variablesStoredInATry() {
    const n = this.next();
    const size = this.size(this.plainly(85, 32, () => 256));
    const any = this.typed("any");
    const at = this.place(size);
    const names = this.upTo(size).map(each => `t${each}`);
    this.emit(
      `function may${n}(x${any}, at${any}) { if (x === at) throw new Error("at " + at); return x + at; }`,
      `function tried${n}(x${any}) {`,
      `  let ${names.map(name => `${name}${any} = 0`).join(", ")};`,
      `  try {`,
      ...names.map(
        (name, each) =>
          `    ${name} = ${this.pick([`may${n}(x, ${each})`, `may${n}(x, ${each})`, `x + ${each}`, `${names[Math.max(each - 1, 0)]} + 1`])};`,
      ),
      `  } catch (error) {`,
      `    return "caught " + [${names.join(", ")}].join();`,
      `  }${this.plainly(60, "", () => ` finally { ${names[at]} = "f"; }`)}`,
      `  return [${names.join(", ")}].join();`,
      `}`,
      `printValue("tried ${n}", tried${n}(-1).length, tried${n}(0).slice(0, 60), tried${n}(${at}).slice(-60), tried${n}(${size - 1}).slice(-60));`,
    );
  }

  oneOfMany() {
    const n = this.next();
    const any = this.typed("any");
    const [most, make, use] = this.pick([
      [1024, (at: number) => `"w${at}"`, `one.length + one`],
      [1024, (at: number) => `(x${any}) => x + ${at}`, `one(1)`],
      [
        1024,
        (at: number) => `{ a${at % 50}: ${at}, ["b" + ${at}]: 1, c${at}: 2 }`,
        `Object.keys(one).length + (one.a1 ?? 0)`,
      ],
      [1024, (at: number) => `{ a: ${at}, c${at}: 2 }`, `one.a`],
      [256, (at: number) => `Symbol("s${at}")`, `one.description`],
      [96, (at: number) => `/a${at}/`, `one.test("a${1}") + one.source`],
      [128, (at: number) => `new (class K${at} { v = ${at}; get() { return this.v; } })()`, `one.get()`],
      [
        64,
        (at: number) =>
          [
            "Math",
            "JSON",
            "Reflect",
            "Object",
            "Array",
            "String",
            "Number",
            "Boolean",
            "Symbol",
            "Map",
            "Set",
            "WeakMap",
            "WeakSet",
            "Promise",
            "RegExp",
            "Date",
            "Error",
            "TypeError",
            "RangeError",
            "Function",
            "BigInt",
            "Proxy",
            "ArrayBuffer",
            "DataView",
            "Uint8Array",
            "Int32Array",
            "Float64Array",
            "Atomics",
            "Intl",
            "globalThis",
            "console",
            "URL",
          ][at % 32],
        `typeof one + (one.name ?? one[Symbol.toStringTag] ?? "")`,
      ],
      [
        64,
        (at: number) =>
          [
            "new Map()",
            "new Set()",
            "[]",
            "{}",
            "new Date(0)",
            "/x/",
            "new Error('e')",
            "new Uint8Array(1)",
            "new ArrayBuffer(1)",
            "Promise.resolve()",
            "new WeakMap()",
            "() => 1",
            "new Int16Array(1)",
            "new DataView(new ArrayBuffer(1))",
            "new URL('a:b')",
            "new TypeError('t')",
            "Symbol.iterator",
            "1n",
            "new Float32Array(1)",
            "new WeakSet()",
            "new String('s')",
            "new Number(1)",
            "new Boolean(true)",
            "function* () {}",
            "async () => 1",
            "new Proxy({}, {})",
            "new BigInt64Array(1)",
            "new Uint16Array(1)",
            "new RangeError('r')",
            "new Uint32Array(1)",
            "new Int8Array(1)",
            "new Headers()",
          ][at % 32],
        `Object.prototype.toString.call(one)`,
      ],
    ] as const);
    const size = this.size(
      this.plainly(85, Math.min(most, 96), () => most),
      2,
    );
    this.emit(
      `{`,
      `  const table${this.typed("any[]")} = [`,
      ...this.upTo(size).map(at => `    ${make(at)},`),
      `  ];`,
      `  ${this.plainly(60, "", () => `table[${this.place(size)}] = ${this.odd()};`)}`,
      `  let out = "";`,
      `  for (let i = 0; i < ${size + 3}; i++) { const one${any} = table[i % table.length]; try { out += ${use}; } catch { out += "!"; } }`,
      `  printValue("one of ${n}", out.length, out.slice(0, 50), out.slice(-30));`,
      `}`,
    );
  }

  nesting() {
    const n = this.next();
    const depth = this.size(this.plainly(90, 128, () => 512));
    const [open, middle, close] = this.pick([
      ["(", "x", ")"],
      ["[", "x", "]"],
      ["{ a: ", "x", " }"],
      ["(x ? ", "x", " : 0)"],
      ["(() => ", "x", ")()"],
      ["- ", "x", ""],
      ["!", "x", ""],
      ["1 + (", "x", ")"],
      ["String(", "x", ")"],
      ["`${", "x", "}`"],
      ["typeof ", "x", ""],
      ["[...", "[x]", "]"],
    ]);
    const statement = this.chance(30);
    if (statement) {
      const [begin, end] = this.pick([
        ["{ ", " }"],
        ["if (x) { ", " }"],
        ["for (let i = 0; i < 1; i++) { ", " }"],
        ["try { ", " } finally { count++; }"],
        ["switch (1) { case 1: ", " }"],
      ]);
      this.emit(
        `function deep${n}(x${this.typed("any")}) {`,
        `  let count = 0;`,
        `  ${begin.repeat(depth)}count += x;${end.repeat(depth)}`,
        `  return count;`,
        `}`,
      );
    } else
      this.emit(
        `function deep${n}(x${this.typed("any")})${this.typed("any")} { return ${open.repeat(depth)}${middle}${close.repeat(depth)}; }`,
      );
    this.emit(
      `printValue("deep ${n}", JSON.stringify(deep${n}(1))?.length, String(deep${n}(${this.odd()})).slice(0, 40));`,
    );
  }

  namesOfTheGlobalObject() {
    const n = this.next();
    const size = this.size(this.plainly(90, 128, () => 4096));
    const at = this.place(size);
    const own = (each: number) => `g${n}x${each}`;
    const read = this.isTypeScript ? (each: number) => `(globalThis as any).${own(each)}` : own;
    this.emit(
      ...this.upTo(size).map(each => `${this.cast("globalThis")}.${own(each)} = ${each};`),
      `${this.plainly(50, "", () => this.pick([`delete ${this.cast("globalThis")}.${own(at)};`, `Object.defineProperty(globalThis, "${own(at)}", { get() { return "got"; }, configurable: true });`, `${this.cast("globalThis")}.${own(at)} = ${this.odd()};`]))}`,
      `{`,
      `  let sum${this.typed("any")} = 0;`,
      `  try { sum = ${this.upTo(size).map(read).join(" + ")}; } catch (error) { sum = (error${this.isTypeScript ? " as any" : ""}).name; }`,
      `  printValue("globals ${n}", String(sum).slice(0, 60), typeof ${read(at)}, typeof ${read(size)});`,
      `}`,
    );
  }

  textsFoldedWhileCompiling() {
    const n = this.next();
    const size = this.pick([
      255, 256, 4095, 4096, 16383, 16384, 32767, 32768, 65535, 65536, 65537, 131072, 262143, 262144, 262145,
    ]);
    const form = this.pick([
      `"a".repeat(${size})`,
      `"ab".repeat(${size >> 1})`,
      `"é".repeat(${size})`,
      `"x".padEnd(${size}, "ab")`,
      `"a".repeat(${size >> 1}) + "b".repeat(${size - (size >> 1)})`,
      `"a".repeat(${size}).toUpperCase()`,
      `new Array(${size + 1}).join("a")`,
      `"a,".repeat(${size >> 1}).split(",").join("b")`,
      `Array.from({ length: ${Math.max(size >> 8, 1)} }, () => "${"w".repeat(256)}").join("")`,
      `Array.from({ length: ${Math.max(size >> 8, 1)} }, () => "${"w".repeat(255)}").join(",")`,
    ]);
    this.emit(
      `{`,
      `  const long = ${form};`,
      `  let built = ""; for (let i = 0; i < ${this.pick([1, 3, 9, 1025])}; i++) built += ${this.pick(["long", "long", `long.slice(0, ${this.pick([4095, 4096, 65535, 65536])})`, `"-"`])};`,
      `  const record${this.typed("any")} = { [long.slice(0, ${this.pick([63, 64, 65, 511, 512, 8192])})]: 1 };`,
      `  printValue("long ${n}", long.length, long.charCodeAt(${size - 1}), long.slice(-3), built.length, built.charCodeAt(built.length >> 1), record[long.slice(0, ${this.pick([63, 64, 65, 511, 512, 8192])})], long === ${form}, Bun.hash.crc32(built));`,
      `}`,
    );
  }

  textsParsed() {
    const n = this.next();
    const size = this.size(this.plainly(85, 96, () => 512));
    const at = this.place(size);
    const kinds = this.upTo(size).map(() =>
      this.pick(["number", "number", "string", "boolean", "number[]", "{ in: number }"]),
    );
    const valueOf = (kind: string, each: number) =>
      ({
        number: String(each),
        string: `"t${each}"`,
        boolean: "true",
        "number[]": `[${each}]`,
        "{ in: number }": `{"in":${each}}`,
      })[kind]!;
    const members = kinds.map((kind, each) => `"m${each}":${valueOf(kind, each)}`);
    const oddly = [...members];
    oddly[at] = this.pick([
      `"m${at}":null`,
      `"m${at}":"other"`,
      `"other":1`,
      `"m${at}":1.5`,
      `"m${at}":{}`,
      `"m${at}":1,"m${at}":2`,
      `"__proto__":{"m${at}":1}`,
      `"m${at}":[]`,
      `"m${at}":1e400`,
      `"m${at}":-0`,
    ]);
    if (this.chance(30)) oddly.reverse();
    if (this.isTypeScript)
      this.emit(
        `type Parsed${n} = { ${kinds.map((kind, each) => `m${each}${each === at && this.chance(30) ? "?" : ""}: ${kind}`).join("; ")} };`,
      );
    const as = this.isTypeScript ? ` as Parsed${n}` : "";
    this.emit(
      `function parse${n}(text${this.typed("string")}) {`,
      `  const one = JSON.parse(text)${as};`,
      `  return ${this.pick([`one.m0 + ":" + one.m${at} + ":" + one.m${size - 1}`, `JSON.stringify(one).length + ":" + typeof one.m${at}`, `Object.keys(one).length + ":" + Object.keys(one)[${at}]`, `String(one.m${at}) + Object.is(one.m${at}, -0)`])};`,
      `}`,
      `printValue("parsed ${n}", parse${n}(${JSON.stringify(`{${members.join(",")}}`)}), parse${n}(${JSON.stringify(`{${oddly.join(",")}}`)}));`,
    );
  }

  parsesInsideParses() {
    const n = this.next();
    const depth = this.size(32);
    this.emit(
      `function inside${n}(depth${this.typed("number")})${this.typed("any")} {`,
      `  return JSON.parse('{"a":[1,{"b":2}],"c":"t"}', function (${this.isTypeScript ? "this: any, " : ""}key${this.typed("string")}, value${this.typed("any")}${this.chance(50) ? `, context${this.isTypeScript ? "?: any" : ""}` : ""}) {`,
      `    if (key === "b" && depth > 0) return inside${n}(depth - 1);`,
      `    return ${this.pick(["value", "value", `typeof value === "number" ? value + depth : value`, `key === "c" ? undefined : value`])};`,
      `  });`,
      `}`,
      `printValue("inside ${n}", JSON.stringify(inside${n}(${depth})).length, JSON.stringify(inside${n}(0)));`,
    );
  }

  shapesWrittenAsText() {
    const n = this.next();
    const size = this.size(24, 1);
    const any = this.typed("any");
    const shape = (at: number) =>
      this.pick([`{ a: ${at}, s${at}: "t" }`, `{ s${at}: ${at} }`, `{ a: ${at}, b: { s${at}: [${at}] } }`]);
    this.emit(
      `function write${n}(one${any}) { return JSON.stringify(one); }`,
      `{`,
      `  const all${this.typed("any[]")} = [${this.upTo(size).map(shape).join(", ")}];`,
      `  all.push(${this.pick([this.odd(), `{ toJSON() { return "j"; } }`, `{ a: undefined, b: () => 1, c: Symbol() }`, `[undefined, () => 1]`, `{ a: 1n }`, `new Map([[1, 2]])`, `{ a: new Date(0) }`, `{ "é\\n": "\\u2028\\ud800" }`, `Object.create({ above: 1 })`])});`,
      `  let out = ""; for (let turn = 0; turn < ${this.pick([1, 50])}; turn++) for (const one of all) { try { out = out.slice(-200) + write${n}(one); } catch (error) { out += (error${this.isTypeScript ? " as any" : ""}).name; } }`,
      `  printValue("written ${n}", out);`,
      `}`,
    );
  }

  generators() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 12, () => 128),
      0,
    );
    const any = this.typed("any");
    const first = this.pick([
      `walk.return(5)`,
      `walk.throw(new Error("early"))`,
      `walk.next(9)`,
      `walk.next()`,
      `walk[Symbol.iterator]() === walk`,
      `[...walk].length`,
      `walk.return()`,
    ]);
    const wrap = this.plainly(60, ["", ""], () =>
      this.pick([
        ["try { ", ` } finally { log${n} += "f"; }`],
        ["try { ", ` } catch (error) { log${n} += "c"; yield -1; }`],
      ]),
    );
    this.emit(
      `let log${n} = "";`,
      `function* steps${n}(x${any})${any} {`,
      `  log${n} += "s";`,
      `  ${wrap[0]}${this.upTo(size)
        .map(at =>
          this.pick([
            `yield x + ${at};`,
            `yield x + ${at};`,
            `log${n} += yield ${at};`,
            `yield* [${at}, x];`,
            `if (x > ${at}) yield ${at};`,
          ]),
        )
        .join(" ")}${wrap[1]}`,
      `  return "end";`,
      `}`,
      `{`,
      `  const show = (step${any}) => { try { const got = step(); return typeof got === "object" ? JSON.stringify(got) : String(got); } catch (error) { return "threw " + (error${this.isTypeScript ? " as any" : ""}).message; } };`,
      `  const walk = steps${n}(1);`,
      `  const said = [show(() => ${first}), show(() => walk.next(7)), show(() => walk.next(8))];`,
      `  let sum${any} = 0; for (const each of steps${n}(${this.pick(["2", "2", this.odd()])})) { sum += each; ${this.plainly(60, "", () => `if (sum > 5) break;`)} }`,
      `  const [a, b] = steps${n}(3);`,
      `  printValue("steps ${n}", said.join(" "), String(sum), a, b, log${n}.length, log${n}.slice(0, 40));`,
      `}`,
    );
  }

  callbacksHandedToOwnFunctions() {
    const n = this.next();
    const size = this.size(this.plainly(85, 48, () => 256));
    const callers = this.size(this.plainly(85, 8, () => 250));
    const any = this.typed("any");
    this.emit(
      `function each${n}(list${any}, f${any}) {`,
      `  let out${any} = 0;`,
      ...this.upTo(size).map(at => `  out += f(list[${at % 4}], ${at});`),
      `  for (let i = 0; i < list.length; i++) out += f(list[i], i);`,
      `  return out;`,
      `}`,
      `{`,
      `  const list = [1, 2, 3, ${this.plainly(60, "4", () => this.odd())}];`,
      `  const said = [`,
      ...this.upTo(callers).map(
        at =>
          `    each${n}(list, ${this.pick([`(x${any}, i${any}) => x + i + ${at}`, `(x${any}) => x * ${at}`, `(x${any}, i${any}) => (i === ${at} ? "t" : x)`, `Math.max`, `(x${any}) => x`, `function (x${any}) { return arguments.length + x; }`])}),`,
      ),
      `  ];`,
      `  printValue("callbacks ${n}", said.length, String(said[0]).slice(0, 40), String(said[said.length - 1]).slice(0, 40), Bun.hash.crc32(said.join()));`,
      `}`,
    );
  }

  valuesAskedWhatTheyAre() {
    const n = this.next();
    const size = this.size(this.plainly(85, 32, () => 512));
    const any = this.typed("any");
    const test = (name: string) =>
      this.pick([
        `typeof ${name} === "number"`,
        `typeof ${name} === "string"`,
        `Array.isArray(${name})`,
        `${name} instanceof Map`,
        `${name} === null`,
        `typeof ${name} === "object"`,
        `Number.isInteger(${name})`,
        `${name} === undefined`,
        `typeof ${name} === "function"`,
        `${name} instanceof Error`,
      ]);
    this.emit(
      `function asked${n}(list${any}) {`,
      `  let out = 0;`,
      ...this.upTo(size).map(
        at =>
          `  { const v = list[${at % 12}]; if (${test("v")}) out += ${at}; ${this.chance(30) ? `else if (${test("v")}) out -= ${at};` : ""} }`,
      ),
      `  return out;`,
      `}`,
      `printValue("asked ${n}", asked${n}([1, "a", [], new Map(), null, {}, 1.5, undefined, () => 1, new Error("e"), -0, ${this.odd()}]), asked${n}([]), asked${n}("abcdefghijkl"));`,
    );
  }

  bundledCode() {
    const n = this.next();
    const size = this.size(12);
    if (this.isTypeScript) return this.kindsToldApartByATag();
    const at = this.place(size);
    const kind = this.pick(["commonjs", "commonjs", "export", "export", "private", "private", "stars"]);
    if (kind === "commonjs") {
      const helper = this.pick([
        `(cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports)`,
        `(callback, module2) => () => {\n  if (!module2) {\n    module2 = {exports: {}};\n    callback(module2.exports, module2);\n  }\n  return module2.exports;\n}`,
      ]);
      this.emit(`var __commonJS${n} = ${helper};`);
      for (const each of this.upTo(size))
        this.emit(
          `var require_m${n}_${each} = __commonJS${n}((exports, module) => { ran${n} += "${each % 10}"; ${each ? `var before = require_m${n}_${this.pick([each - 1, 0, each === at ? each : each - 1])}(); ` : ""}${this.pick([`exports.v = ${each};`, `module.exports = { v: ${each} };`, `exports.v = ${each ? "(before.v ?? -5) + 1" : "0"};`, `module.exports = function v() { return ${each}; }; module.exports.v = ${each};`])} });`,
        );
      this.emit(
        `var ran${n} = "";`,
        `printValue("bundled ${n}", require_m${n}_${size - 1}().v, require_m${n}_${at}().v, require_m${n}_${at}() === require_m${n}_${at}(), ran${n});`,
      );
    } else if (kind === "export") {
      this.emit(
        `var __defProp${n} = Object.defineProperty;`,
        `var __export${n} = (target, all) => {\n  for (var name in all)\n    __defProp${n}(target, name, { get: all[name], enumerable: true });\n};`,
        `var space${n} = {};`,
        `__export${n}(space${n}, { ${this.upTo(size)
          .map(each => `e${each}: () => e${n}_${each}`)
          .join(", ")} });`,
        ...this.upTo(size).map(
          each =>
            `${each === at ? "let" : "var"} e${n}_${each} = ${this.pick([String(each), `() => ${each}`, `"t"`])};`,
        ),
        `{`,
        `  let stored = "no"; try { space${n}.e${at} = 5; stored = "stored"; } catch (error) { stored = error.name; }`,
        `  e${n}_${at} = ${this.odd()};`,
        `  printValue("exported ${n}", Object.keys(space${n}).join(), String(space${n}.e${at}), String(space${n}.e0), stored, JSON.stringify(Object.getOwnPropertyDescriptor(space${n}, "e0")));`,
        `}`,
      );
    } else if (kind === "private") {
      this.emit(
        `var __classPrivateFieldGet${n} = function (receiver, state, kind, f) {\n    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");\n    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");\n    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);\n};`,
        `var __classPrivateFieldSet${n} = function (receiver, state, value, kind, f) {\n    if (kind === "m") throw new TypeError("Private method is not writable");\n    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");\n    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");\n    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;\n};`,
        `var ${this.upTo(size)
          .map(each => `_Box${n}_f${each}`)
          .join(", ")};`,
        `class Box${n} {`,
        `  constructor(x) { ${this.upTo(size)
          .map(each => `_Box${n}_f${each}.set(this, x + ${each});`)
          .join(" ")} }`,
        `  sum() { return ${this.upTo(size)
          .map(each => `__classPrivateFieldGet${n}(this, _Box${n}_f${each}, "f")`)
          .join(" + ")}; }`,
        `  put(value) { __classPrivateFieldSet${n}(this, _Box${n}_f${at}, value, "f"); return this; }`,
        `}`,
        `${this.upTo(size)
          .map(each => `_Box${n}_f${each} = new WeakMap()`)
          .join(", ")};`,
        `{`,
        `  let other; try { other = Box${n}.prototype.sum.call(${this.pick(["{}", `Object.create(new Box${n}(1))`, "null", `new Proxy(new Box${n}(1), {})`])}); } catch (error) { other = error.message; }`,
        `  printValue("boxes ${n}", new Box${n}(1).sum(), String(new Box${n}(2).put(${this.odd()}).sum()), other);`,
        `}`,
      );
    } else {
      this.files.push([
        `./lib-${n}-a.cjs`,
        `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n${this.upTo(size)
          .map(each => `exports.a${each} = ${each};`)
          .join("\n")}\nexports.default = "d";\n`,
      ]);
      this.files.push([
        `./lib-${n}.cjs`,
        `"use strict";\nvar __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var desc = Object.getOwnPropertyDescriptor(m, k);\n    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }\n    Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}));\nvar __exportStar = (this && this.__exportStar) || function(m, exports) {\n    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);\n};\nObject.defineProperty(exports, "__esModule", { value: true });\n${this.chance(40) ? `exports.a${at} = "own";\n` : ""}__exportStar(require("./lib-${n}-a.cjs"), exports);\n`,
      ]);
      this.imports.push(
        this.pick([
          `import * as lib${n} from "./lib-${n}.cjs";`,
          `import lib${n} from "./lib-${n}.cjs";`,
          `const lib${n} = require("./lib-${n}.cjs");`,
        ]),
      );
      this.emit(
        `printValue("stars ${n}", lib${n}.a${at}, lib${n}.a0, lib${n}.a${size}, Object.keys(lib${n}).length, typeof lib${n}.default);`,
      );
    }
  }

  modulesOfMachineCode() {
    const n = this.next();
    // (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
    const bytes = [
      0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9,
      1, 7, 0, 32, 0, 32, 1, 106, 11,
    ];
    if (this.chance(20)) bytes[this.below(bytes.length)] ^= 1 << this.below(8);
    const made = this.pick([
      `new WebAssembly.Instance(new WebAssembly.Module(bytes))`,
      `new WebAssembly.Instance(new WebAssembly.Module(bytes))`,
      `(await WebAssembly.instantiate(bytes)).instance`,
      `await WebAssembly.instantiate(await WebAssembly.compile(bytes))`,
    ]);
    const text = Buffer.from(bytes).toString("base64");
    const written = this.pick([
      `new Uint8Array([${bytes.join(", ")}])`,
      `new Uint8Array(Buffer.from("${text}", "base64"))`,
      `Uint8Array.from(atob("${text}"), (unit${this.typed("any")}) => unit.charCodeAt(0))`,
      `new Uint8Array(Buffer.from("data:application/wasm;base64,${text}".split(",")[1], "base64"))`,
      `new Uint8Array(await (await fetch("data:application/wasm;base64,${text}")).arrayBuffer())`,
    ]);
    this.emit(
      `{`,
      `  const bytes = ${written};`,
      `  let said; try { const add${this.typed("any")} = ${this.cast(made)}.exports.add; said = [add(1, 2), add(2147483647, 1), add(${this.odd()}, 1), add(), WebAssembly.validate(bytes)].join(); } catch (error) { said = (error${this.isTypeScript ? " as any" : ""}).name; }`,
      `  printValue("machine code ${n}", said);`,
      `}`,
    );
  }

  keysOfEveryLength() {
    const n = this.next();
    const length = this.pick([1, 2, 7, 8, 9, 63, 64, 65, 511, 512, 513, 8191, 8192, 8193]);
    const pieces = this.pick([1, 2, 15, 16, 17, 18, 40]);
    const names = this.size(this.plainly(90, 64, () => 4096));
    const any = this.typed("any");
    this.emit(
      `{`,
      `  const record${any} = {};`,
      `  for (let i = 0; i < ${names}; i++) record["n" + i + "${"x".repeat(3)}".repeat(${Math.max(length >> 2, 1)})] = i;`,
      `  let key = ""; for (let i = 0; i < ${pieces}; i++) key += "${"k".repeat(Math.max(Math.floor(length / pieces), 1))}";`,
      `  record[key] = "found";`,
      `  let again = ""; for (let i = 0; i < ${pieces}; i++) again = again + "${"k".repeat(Math.max(Math.floor(length / pieces), 1))}";`,
      `  let hits = 0; for (let turn = 0; turn < 20; turn++) if (record[again] === "found") hits++;`,
      `  printValue("long keys ${n}", hits, key.length, record[again + "k"], again in record, Object.keys(record).length, record["n1" + "xxx".repeat(${Math.max(length >> 2, 1)})]);`,
      `}`,
    );
  }

  textsBuiltInsideTextsBeingBuilt() {
    const n = this.next();
    const depth = this.size(16);
    this.emit(
      `function build${n}(depth${this.typed("number")})${this.typed("string")} {`,
      `  let out = "";`,
      `  for (let i = 0; i < ${this.pick([5, 6, 40])}; i++) { out += "<"; out += i; if (i === 2 && depth > 0) out += build${n}(depth - 1); out += ">"; ${this.plainly(70, "", () => `if (i === 3 && depth === ${depth >> 1}) out += "${"w".repeat(300)}".repeat(${this.pick([14, 220, 900])}); `)}}`,
      `  return out;`,
      `}`,
      `{ const built = build${n}(${depth}); printValue("nested texts ${n}", built.length, built.slice(0, 30), built.slice(-30), Bun.hash.crc32(built)); }`,
    );
  }

  /** A function over a declared type, called with what the type says and then with one value that is not: a member is missing, is of another kind or stands elsewhere. It comes through `any`, a parser or a declaration file. */
  valuesThatAreNotWhatTheirTypeSays() {
    if (!this.isTypeScript) return this.literalArgument();
    const n = this.next();
    const size = this.size(6, 2);
    const kinds = ["number", "number", "string", "number[]", "boolean", "{ x: number }", "string[]"];
    const honest: Record<string, () => string> = {
      number: () => this.pick(["1", "2", "0.125", "7", "-3"]),
      string: () => this.pick(['"s"', '"text"', '""']),
      "number[]": () => this.pick(["[1, 2]", "[1.5]", "[]", "[3, 4, 5]"]),
      boolean: () => this.pick(["true", "false"]),
      "{ x: number }": () => this.pick(['{ "x": 1 }', '{ "x": 2.5 }']),
      "string[]": () => this.pick(['["a"]', '["a", "b"]']),
    };
    const members = this.upTo(size).map(at => ({ name: `m${at}`, kind: this.pick(kinds) }));
    const at = this.place(size);
    const read = (member: { name: string; kind: string }) =>
      this.pick(
        {
          number: [
            `p.${member.name}`,
            `p.${member.name}`,
            `p.${member.name} + 1`,
            `p.${member.name} * 2`,
            `p.${member.name} | 0`,
            `-p.${member.name}`,
            `Math.floor(p.${member.name})`,
          ],
          string: [
            `p.${member.name}`,
            `p.${member.name}`,
            `p.${member.name}.length`,
            `p.${member.name} + "!"`,
            `p.${member.name}.charCodeAt(0)`,
          ],
          "number[]": [
            `p.${member.name}`,
            `p.${member.name}`,
            `p.${member.name}.length`,
            `p.${member.name}[0]`,
            `p.${member.name}[0] + 1`,
            `p.${member.name}.slice()`,
          ],
          boolean: [`p.${member.name}`, `!p.${member.name}`, `p.${member.name} ? 1 : 2`],
          "{ x: number }": [`p.${member.name}`, `p.${member.name}.x`, `p.${member.name}.x + 1`],
          "string[]": [`p.${member.name}`, `p.${member.name}.join()`, `p.${member.name}[0]`],
        }[member.kind]!,
      );
    const taken = this.upTo(1 + this.below(3)).map(() => this.pick([members[at], members[at], this.pick(members)]));
    const results = taken.map((member, each) => `r${each}: ${read(member)}`);
    results.splice(this.below(results.length + 1), 0, `c: ${this.pick(["0.125", "1", '"c"', "[0.5]"])}`);
    const body = this.pick([
      [`return { ${results.join(", ")} };`],
      [`return { ${results.join(", ")} };`],
      [`return { ${results.join(", ")} };`],
      [`const made = { ${results.join(", ")} };`, `kept${n}.push(made);`, `return made;`],
      [
        `const { ${members.map(member => member.name).join(", ")} } = p;`,
        `return { c: 1, all: [${members.map(member => member.name).join(", ")}] };`,
      ],
      [`const copy = { ...p };`, `return { c: Object.keys(copy).length, copy };`],
      [`held${n}.push(p);`, `return { c: held${n}.length, first: held${n}[held${n}.length - 1].${members[at].name} };`],
      [
        `const box = new Box${n}(p);`,
        `return { c: 1, inner: box.p.${members[at].name}, ${results.filter(each => !each.startsWith("c:")).join(", ")} };`,
      ],
    ]);
    const written = members.map(member => `"${member.name}": ${honest[member.kind]()}`);
    const oddly = [...written];
    const other = () =>
      this.pick([
        "-1.5",
        "1",
        '"w"',
        "null",
        "[1]",
        "[]",
        "{}",
        "true",
        '{ "x": "t" }',
        "[1.5, null]",
        '["q"]',
        "2147483648",
        "-0",
      ]);
    const how = this.pick(["lacks", "lacks", "lacks", "kind", "kind", "order", "more", "both", "both"]);
    if (how === "lacks") oddly.splice(at, 1);
    else if (how === "kind") oddly[at] = `"${members[at].name}": ${other()}`;
    else if (how === "order") oddly.reverse();
    else if (how === "more") oddly.unshift(`"z": 1`);
    else {
      oddly[at] = `"${members[at].name}": ${other()}`;
      oddly.splice((at + 1) % size, 1);
    }
    const liar = this.plainly(85, `{ ${oddly.join(", ")} }`, () =>
      this.pick([
        "null",
        "[]",
        "1",
        '"text"',
        `Object.create({ ${written.join(", ")} })`,
        `new (class { ${members.map(member => `${member.name} = ${honest[member.kind]()};`).join(" ")} })()`,
        `{ ${written.slice(1).join(", ")}${size > 1 ? ", " : ""}get ${members[0].name}() { return ${other()}; } }`,
      ]),
    );
    const type = `{ ${members.map(member => `${member.name}: ${member.kind}`).join("; ")} }`;
    const isText = liar.startsWith('{ "') && !liar.includes("get ") && !liar.includes("-0");
    const road = this.pick([
      "launder",
      "launder",
      "cast",
      "unknown",
      "list",
      "generic",
      ...(isText ? ["parse", "parse"] : []),
      "file",
      "file",
      "maker",
    ]);
    let odd = "";
    const before: string[] = [];
    if (road === "launder") (before.push(`const launder${n} = (v: any): In${n} => v;`), (odd = `launder${n}(${liar})`));
    else if (road === "cast") odd = `(${liar} as any as In${n})`;
    else if (road === "unknown") odd = `(${liar} as unknown as In${n})`;
    else if (road === "list")
      (before.push(`const given${n}: In${n}[] = [{ ${written.join(", ")} }, ${liar} as any];`), (odd = `given${n}[1]`));
    else if (road === "generic")
      (before.push(`function as${n}<T>(v: unknown): T { return v as T; }`), (odd = `as${n}<In${n}>(${liar})`));
    else if (road === "parse") odd = `(JSON.parse(${JSON.stringify(liar)}) as In${n})`;
    else {
      const isMaker = road === "maker";
      this.files.push([
        `./given-${n}.js`,
        isMaker ? `export function make() { return ${liar}; }\n` : `export const odd = ${liar};\n`,
      ]);
      this.files.push([
        `./given-${n}.d.ts`,
        isMaker ? `export declare function make(): ${type};\n` : `export declare const odd: ${type};\n`,
      ]);
      this.imports.push(`import { ${isMaker ? "make" : "odd"} as given${n} } from "./given-${n}.js";`);
      odd = isMaker ? `given${n}()` : `given${n}`;
    }
    const shown = this.pick([`.c`, `.c`, `.c`, ``, ``]);
    const show = (value: string) => (shown ? `${value}${shown}` : `JSON.stringify(${value})`);
    const guarded = this.chance(35) || !liar.startsWith("{");
    this.emit(
      `interface In${n} ${type}`,
      `const kept${n}: unknown[] = [];`,
      `const held${n}: In${n}[] = [];`,
      `class Box${n} { constructor(public p: In${n}) {} }`,
      `function turn${n}(p: In${n}) {`,
      ...body.map(line => "  " + line),
      `}`,
      ...before,
      `for (let i = 0; i < ${this.pick([1, 1, 3, 300])}; i++) turn${n}({ ${written.join(", ")} });`,
      `const odd${n} = ${odd};`,
      guarded
        ? `try { for (let i = 0; i < ${this.pick([1, 1, 2, 100])}; i++) if (i < 2) printValue("given ${n}", ${show(`turn${n}(odd${n})`)}); else turn${n}(odd${n}); } catch (error) { printValue("given ${n} threw", (error as any)?.constructor?.name); }`
        : `for (let i = 0; i < ${this.pick([1, 1, 2, 100])}; i++) if (i < 2) printValue("given ${n}", ${show(`turn${n}(odd${n})`)}); else turn${n}(odd${n});`,
    );
  }

  /** `new Response(body, { status, statusText, headers })` with the members written out, and with one that is not. */
  answersMadeFromLiterals() {
    const n = this.next();
    const any = this.typed("any");
    const body = () =>
      this.pick([
        '"text"',
        '""',
        "null",
        "undefined",
        "x",
        "JSON.stringify({ a: x })",
        "new Uint8Array([104, 105])",
        'new Blob(["b"])',
        "`<${x}>`",
      ]);
    const status = () =>
      this.plainly(70, this.pick(["200", "201", "404", "500", "204"]), () =>
        this.pick(["199", "600", "200.5", this.cast('"201"'), "x", "undefined", "NaN", "101", "0"]),
      );
    const headers = () =>
      this.pick([
        '{ "content-type": "text/plain" }',
        '{ "x-a": "1", "x-b": "2" }',
        '[["x-a", "1"]]',
        'new Headers({ "x-a": "1" })',
        "undefined",
        "{}",
        this.cast('{ "x-a": 1 }'),
        this.cast('{ "bad name": "1" }'),
        '{ "x-a": "\\u00e9" }',
        "shared",
      ]);
    const members = [
      `status: ${status()}`,
      `statusText: ${this.pick(['"Fine"', '""', "undefined", this.cast("1"), '"\\u0101"'])}`,
      `headers: ${headers()}`,
    ].filter(() => this.chance(70));
    const oddly = this.plainly(50, members, () => [
      ...members,
      this.pick([
        "...more",
        "extra: 1",
        "__proto__: more",
        ...(this.isTypeScript ? [] : [`get status() { seen${n}++; return 202; }`, `["status"]: 203`, "status: 205"]),
      ]),
    ]);
    const made = this.pick([
      (init: string) => `new Response(${body()}, ${init})`,
      (init: string) => `new Response(${body()}, ${init})`,
      (init: string) => `Response.json({ a: x }, ${init})`,
      (init: string) => `new Response(${body()}, ${this.cast(`Object.freeze(${init})`)})`,
    ]);
    this.emit(
      `let seen${n} = 0;`,
      `async function answer${n}(x${any}) {`,
      `  const shared = new Headers({ "x-s": "1" });`,
      `  const more${any} = { status: 207, statusText: "More" };`,
      `  const one = ${made(this.cast(`{ ${oddly.join(", ")} }`))};`,
      `  shared.set("x-s", "2");`,
      `  return [one.status, one.statusText, one.ok, one.headers.get("x-a"), one.headers.get("x-s"), one.headers.get("content-type"), ${this.pick(["await one.text()", "(await one.arrayBuffer()).byteLength", "one.bodyUsed", "(await one.clone().text()).length"])}].join("|");`,
      `}`,
      `{`,
      `  const said = [];`,
      `  for (const x of [1, ${this.odd()}]) { try { said.push(await answer${n}(x)); } catch (error) { said.push((error${this.isTypeScript ? " as any" : ""})?.constructor?.name); } }`,
      `  printValue("answers ${n}", said.join(" "), seen${n});`,
      `}`,
    );
  }

  /** CommonJS files that require each other: at the top, inside functions, in a circle, in a `try`. */
  oldModulesThatRequireEachOther() {
    const n = this.next();
    const size = this.size(
      this.plainly(90, 8, () => 32),
      2,
    );
    const file = (at: number) => `./old-${n}-${at}.cjs`;
    for (const at of this.upTo(size)) {
      const lines = [`exports.order = "${at % 10}";`];
      if (at > 0)
        lines.push(
          this.pick([
            `const before = require("${file(at - 1)}");`,
            `const before = require("${file(at - 1)}");`,
            `const { order: beforeOrder, value: beforeValue } = require("${file(at - 1)}"); const before = { order: beforeOrder, value: beforeValue };`,
            `let before; try { before = require("${file(at - 1)}"); } catch (error) { before = { order: "!", value: () => -1 }; }`,
          ]),
        );
      else lines.push(`const before = { order: "", value: () => 0 };`);
      lines.push(
        this.pick([
          `exports.value = () => before.value() + 1;`,
          `exports.value = () => before.value() + 1;`,
          `exports.value = function () { return require("${file((at + 1) % size)}").order.length + before.value(); };`,
          `module.exports = { order: exports.order + before.order, value: () => before.value() + 2 };`,
          `exports.value = () => (typeof before.value === "function" ? before.value() : -100) + require("${file(size - 1)}").order.length;`,
          `if (before.order) exports.value = () => before.value() + 3; else exports.value = () => require("node:path").sep.length;`,
        ]),
      );
      if (at === 0 && this.chance(40))
        lines.splice(1, 0, `const last = require("${file(size - 1)}"); exports.early = typeof last.value;`);
      if (at === this.place(size) && this.chance(25))
        lines.push(
          this.pick([
            `throw new Error("file ${at}");`,
            `module.exports = require("${file(0)}");`,
            `exports.__esModule = true; exports.default = 5;`,
            `delete require.cache[module.id];`,
          ]),
        );
      if (this.chance(30))
        lines.push(
          `exports.asked = String(${this.pick(["!module.parent", "typeof module.parent", "module.children.length", "require.main === module", "module.loaded", "module.children.map(each => each.loaded).join()", "module.parent === require.main"])});`,
        );
      if (at === size - 1 && this.chance(40)) {
        this.files.push([
          `./new-${n}.mjs`,
          `export const a = 1;\n${this.pick(["", "export default 2;\n", "export const __esModule = false;\n"])}`,
        ]);
        lines.push(
          `const es = require("./new-${n}.mjs"); exports.es = [es.__esModule, es.a, Object.keys(es).join()].join(":");`,
        );
      }
      this.files.push([file(at), lines.join("\n") + "\n"]);
    }
    this.imports.push(
      this.pick([
        `import last${n} from "${file(size - 1)}";`,
        `import * as last${n} from "${file(size - 1)}";`,
        `import { createRequire } from "node:module";\nconst last${n} = createRequire(import.meta.url)("${file(size - 1)}");`,
        `const last${n} = require("${file(size - 1)}");`,
      ]),
    );
    this.emit(
      `printValue("old modules ${n}", ${this.cast(`last${n}`)}.order, typeof ${this.cast(`last${n}`)}.value === "function" ? ${this.cast(`last${n}`)}.value() : "none", Object.keys(last${n}).join(), ${this.cast(`last${n}`)}.asked, ${this.cast(`last${n}`)}.es);`,
    );
  }

  /** Many modules of the runtime, one member of each. */
  modulesOfTheRuntime() {
    const n = this.next();
    const every = [
      "path",
      "os",
      "util",
      "events",
      "url",
      "fs",
      "assert",
      "buffer",
      "querystring",
      "string_decoder",
      "crypto",
      "zlib",
      "stream",
      "timers",
      "perf_hooks",
      "async_hooks",
      "module",
      "punycode",
      "v8",
      "vm",
      "tty",
      "readline",
      "net",
      "dns",
      "constants",
      "process",
      "worker_threads",
      "diagnostics_channel",
    ];
    const size = Math.min(this.size(24), every.length);
    const first = this.below(every.length);
    const names = this.upTo(size).map(at => every[(first + at) % every.length]);
    names.forEach((name, at) =>
      this.imports.push(
        this.pick([
          `import * as m${n}_${at} from "node:${name}";`,
          `import m${n}_${at} from "node:${name}";`,
          `import * as m${n}_${at} from "${name}";`,
          `const m${n}_${at} = require("node:${name}");`,
        ]),
      ),
    );
    this.emit(
      `printValue("runtime ${n}", [${names.map((_, at) => `m${n}_${at}`).join(", ")}].map(each => typeof each + Object.keys(each).length.toString().length).join());`,
    );
  }

  /** Loops whose counter leaves the 32-bit integers, or steps by much. */
  countersPastInt32() {
    const n = this.next();
    const step = this.pick([
      "1",
      "2",
      "1023",
      "1024",
      "1025",
      "4096",
      "65536",
      "1000000000",
      "2147483647",
      "2147483648",
      "0.5",
      "-1",
      "-1025",
    ]);
    const start = this.pick(["0", "2147483640", "2147483647", "4294967290", "-2147483650", "9007199254740980", "x"]);
    const turns = this.pick([3, 10, 40]);
    const down = step.startsWith("-");
    this.emit(
      `function count${n}(x${this.typed("number")}) {`,
      `  let sum = 0, turns = 0, last = 0;`,
      `  const list = [1, 2, 3, 4];`,
      `  for (let i = ${start}; ${down ? `i > ${start} - ${turns} * ${step.slice(1)}` : `i < ${start} + ${turns} * ${step}`}; i += ${step}) { sum += ${this.pick(["i", "i % 7", "i | 0", "i >>> 0", "list[i & 3]", "list[i % 4] ?? -1", "i * 2", "(i / 2) | 0"])}; last = i; if (++turns > 100) break; }`,
      `  return [sum, turns, last].join();`,
      `}`,
      `printValue("counter ${n}", count${n}(0), count${n}(2147483646), count${n}(${this.oddNumber()}));`,
    );
  }

  /** Nodes of many kinds that one constructor makes: it stores its first parameter under the tag, and makers add the fields of their kind. */
  kindsMadeByOneConstructor() {
    const n = this.next();
    const size = this.size(
      this.plainly(85, 12, () => 128),
      2,
    );
    const any = this.typed("any");
    const at = this.place(size);
    if (this.isTypeScript) {
      this.emit(
        `const enum Kind${n} { ${this.upTo(size)
          .map(each => `K${each}`)
          .join(", ")} }`,
        `interface Base${n} { kind: Kind${n}; pos: number; flags: number }`,
      );
      for (const each of this.upTo(size))
        this.emit(
          `interface Node${n}_${each} extends Base${n} { kind: Kind${n}.K${each}; ${each % 3 === 0 ? "text: string" : each % 3 === 1 ? `left: Each${n}; right: Each${n} | undefined` : "value: number"} }`,
        );
      this.emit(
        `type Each${n} = ${this.upTo(size)
          .map(each => `Node${n}_${each}`)
          .join(" | ")};`,
      );
    }
    const kind = (each: number) => (this.isTypeScript ? `Kind${n}.K${each}` : String(each));
    const isDirect = this.isTypeScript && this.chance(60);
    const isClass = !isDirect && this.chance(40);
    const fresh = (each: number) =>
      isDirect
        ? `new Maker${n}(${kind(each)}, ${each}) as Node${n}_${each}`
        : `base${n}${this.isTypeScript ? `<Node${n}_${each}>` : ""}(${kind(each)}, ${each})`;
    if (isDirect)
      this.emit(
        `function Direct${n}(this: Base${n}, kind: Kind${n}, pos: number) { this.kind = kind; this.pos = pos; this.flags = 0; }`,
        `const Maker${n} = Direct${n} as any as new (kind: Kind${n}, pos: number) => Base${n};`,
      );
    this.emit(
      isClass
        ? `class Made${n} { kind${any}; pos${this.typed("number")}; flags = 0; constructor(kind${any}, pos${this.typed("number")}) { this.kind = kind; this.pos = pos; } }`
        : `function Made${n}(${this.isTypeScript ? "this: any, " : ""}kind${any}, pos${this.typed("number")}) { this.kind = kind; this.pos = pos; this.flags = 0; }`,
      `function base${n}${this.isTypeScript ? `<T extends Each${n}>` : ""}(kind${this.typed('T["kind"]')}, pos${this.typed("number")})${this.typed("T")} { return new ${this.cast(`Made${n}`)}(kind, pos); }`,
    );
    for (const each of this.upTo(size))
      this.emit(
        each % 3 === 0
          ? `function make${n}_${each}(text${this.typed("string")}) { const node = ${fresh(each)}; node.text = text; return node; }`
          : each % 3 === 1
            ? `function make${n}_${each}(left${this.typed(`Each${n}`)}, right${this.isTypeScript ? `?: Each${n}` : ""}) { const node = ${fresh(each)}; node.left = left; node.right = right; return node; }`
            : `function make${n}_${each}(value${this.typed("number")}) { const node = ${fresh(each)}; node.value = value; return node; }`,
      );
    this.emit(`function weigh${n}(node${this.typed(`Each${n}`)})${this.typed("number")} {`, `  switch (node.kind) {`);
    for (const each of this.upTo(size))
      this.emit(
        `    case ${kind(each)}: return ${each % 3 === 0 ? "node.text.length" : each % 3 === 1 ? `weigh${n}(node.left) + (node.right ? weigh${n}(node.right) : 0)` : "node.value"} + node.pos;`,
      );
    const liar = this.pick([
      `new ${this.cast(`Made${n}`)}(${kind(at)}, 1)`,
      `new ${this.cast(`Made${n}`)}(${size + 5}, 1)`,
      `{ kind: ${kind(at)}, pos: 1, flags: 0, text: "lit", value: 2, left: leaf }`,
      `Object.assign(make${n}_0("t"), { kind: ${kind(Math.min(2, size - 1))} })`,
      `Object.assign(make${n}_0("t"), { text: 5 })`,
      `${this.cast(`Made${n}`)}.call({ text: "called", value: 3 }, ${kind(0)}, 2) ?? leaf`,
      `Reflect.construct(Made${n}, [${kind(0)}, 3], class { })`,
      `make${n}_0(${this.odd()})`,
    ]);
    this.emit(
      `  }`,
      `  return -1;`,
      `}`,
      `{`,
      `  const leaf = make${n}_0("leaf");`,
      `  const all${this.typed(`Each${n}[]`)} = [${this.upTo(size)
        .map(each =>
          each % 3 === 0
            ? `make${n}_${each}("t${each}")`
            : each % 3 === 1
              ? `make${n}_${each}(leaf${each % 2 ? ", leaf" : ""})`
              : `make${n}_${each}(${each}.5)`,
        )
        .join(", ")}];`,
      `  let sum = 0; for (let turn = 0; turn < ${this.pick([1, 100])}; turn++) for (const node of all) sum += weigh${n}(node);`,
      `  let odd${any}; try { odd = weigh${n}(${this.cast(liar)}); } catch (error) { odd = (error${this.isTypeScript ? " as any" : ""})?.constructor?.name; }`,
      `  printValue("nodes ${n}", sum, odd, Object.keys(all[${at}]).join(), JSON.stringify(all[0]));`,
      `}`,
    );
  }

  all = [
    () => this.kindsMadeByOneConstructor(),
    () => this.kindsMadeByOneConstructor(),
    () => this.answersMadeFromLiterals(),
    () => this.answersMadeFromLiterals(),
    () => this.oldModulesThatRequireEachOther(),
    () => this.oldModulesThatRequireEachOther(),
    () => this.modulesOfTheRuntime(),
    () => this.countersPastInt32(),
    () => this.valuesThatAreNotWhatTheirTypeSays(),
    () => this.valuesThatAreNotWhatTheirTypeSays(),
    () => this.valuesThatAreNotWhatTheirTypeSays(),
    () => this.valuesThatAreNotWhatTheirTypeSays(),
    () => this.switchOnNumbers(),
    () => this.switchOnNumbers(),
    () => this.switchOnTexts(),
    () => this.divisions(),
    () => this.divisions(),
    () => this.listLiteral(),
    () => this.listLiteral(),
    () => this.literalArgument(),
    () => this.literalArgument(),
    () => this.restHandedOn(),
    () => this.countedGrowth(),
    () => this.countedGrowth(),
    () => this.awaits(),
    () => this.awaits(),
    () => this.classesWithOneMethod(),
    () => this.classesWithOneMethod(),
    () => this.keysFromParts(),
    () => this.patternsFromTexts(),
    () => this.deepPattern(),
    () => this.modules(),
    () => this.modules(),
    () => this.namesHandedToALoader(),
    () => this.kindsToldApartByATag(),
    () => this.kindsToldApartByATag(),
    () => this.addresses(),
    () => this.textsCompared(),
    () => this.textsPutInOrder(),
    () => this.concatenations(),
    () => this.manyOperands(),
    () => this.manyOperands(),
    () => this.searchedLiteral(),
    () => this.listsOfALength(),
    () => this.listTakenApart(),
    () => this.capturedVariables(),
    () => this.objectLiteral(),
    () => this.objectLiteral(),
    () => this.fieldsAddedLater(),
    () => this.callsHandedDown(),
    () => this.shortLoops(),
    () => this.loopOverManyLists(),
    () => this.longSums(),
    () => this.valuesChosen(),
    () => this.variablesStoredInATry(),
    () => this.oneOfMany(),
    () => this.nesting(),
    () => this.namesOfTheGlobalObject(),
    () => this.textsFoldedWhileCompiling(),
    () => this.textsParsed(),
    () => this.parsesInsideParses(),
    () => this.shapesWrittenAsText(),
    () => this.generators(),
    () => this.callbacksHandedToOwnFunctions(),
    () => this.valuesAskedWhatTheyAre(),
    () => this.bundledCode(),
    () => this.modulesOfMachineCode(),
    () => this.keysOfEveryLength(),
    () => this.textsBuiltInsideTextsBeingBuilt(),
  ];
}

/** The driver writes programs byte for byte: whatever is not ASCII stands in a text, a template or a pattern, where an escape says the same. */
const escaped = (text: string) =>
  text.replace(/[^\x00-\x7f]/g, unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"));

/**
 * `text` with one or two scenes of a drawn size. In seven programs of ten they are the whole program.
 * What is drawn depends on `text` alone.
 */
export function writeScenesOfEverySize(text: string, isTypeScript: boolean) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const first = "const printValue = console.log;\n";
  if (!program.startsWith(first)) return text;
  const random = randomFrom("sizes" + text);
  const sizes = new Sizes(random, isTypeScript, "Z" + Bun.hash.crc32(text).toString(36) + "_");
  for (let count = sizes.pick([1, 1, 1, 2]); count > 0; count--) sizes.pick(sizes.all)();
  const written = escaped(sizes.lines.filter(line => line.trim() !== "").join("\n") + "\n");
  const imports = sizes.imports.length ? sizes.imports.join("\n") + "\n" : "";
  const files = escaped(sizes.files.map(([name, content]) => `// @filename: ${name}\n${content}`).join(""));
  if (sizes.chance(70)) return first + imports + written + "export {};\n" + files;
  const lines = program.split("\n");
  let at = lines.length;
  while (at > 0 && /^(?:printValue\(.*\);|export \{\};|)$/.test(lines[at - 1])) at--;
  return (
    [first.trimEnd(), imports.trimEnd(), ...lines.slice(1, at), written.trimEnd(), ...lines.slice(at)]
      .filter((line, index) => index > 1 || line !== "")
      .join("\n") +
    otherFiles.join("") +
    files
  );
}

/** The kinds of scenes, by the names of their methods. */
export const kindsOfScenes = Object.getOwnPropertyNames(Sizes.prototype).filter(
  name => !["constructor", "size"].includes(name),
);

/** A program that is one scene of the kind `kind`. */
export function writeOneSceneOfEverySize(kind: string, seed: string, isTypeScript: boolean, size?: number) {
  const sizes = new Sizes(randomFrom(kind + seed), isTypeScript, "Z", size);
  (sizes as any)[kind]();
  const imports = sizes.imports.length ? sizes.imports.join("\n") + "\n" : "";
  const files = sizes.files.map(([name, content]) => `// @filename: ${name}\n${content}`).join("");
  return escaped(
    "const printValue = console.log;\n" +
      imports +
      sizes.lines.filter(line => line.trim() !== "").join("\n") +
      "\nexport {};\n" +
      files,
  );
}
