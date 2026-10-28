// Records, instances, lists, maps of lists and proxies, declared by interfaces and classes or not declared at all, are linked so that some hold
// themselves: at once, through a member, a list, a getter, what toJSON answers or what a replacer answers. JSON.stringify writes them. Every toJSON,
// getter, trap and replacer counts its calls and writes its name into a log; the program prints the text or the name of the error, the counts and the order.
import type { Random } from "./random";

export function generate(random: Random): string {
  const lines: string[] = [
    `const order: string[] = [];`,
    `const counts: Record<string, number> = {};`,
    `function ran(name: string) { counts[name] = (counts[name] ?? 0) + 1; if (order.length < 60) order.push(name); }`,
    `interface Leaf { text: string; size: number }`,
    `interface Holder { name: string; self: Holder | null; leaf: Leaf; list: Holder[]; any: unknown; maybe?: Holder }`,
    `interface Pair { left: Pair | null; right: Pair | Leaf | null; tag: "pair" }`,
    `class Node { next: Node | null = null; items: Node[] = []; extra: unknown = undefined; constructor(public label: string) {} }`,
    `class Telling extends Node { toJSON(key: string) { ran("toJSON " + this.label); return WHAT; } }`,
    `const holder = (name: string): Holder => ({ name, self: null, leaf: { text: name, size: name.length }, list: [], any: undefined });`,
    `const pair = (): Pair => ({ left: null, right: null, tag: "pair" });`,
  ];
  const what = random.pick([
    `{ label: this.label, next: this.next }`,
    `this.label`,
    `{ ...this }`,
    `this.items`,
    `[this.next]`,
    `{ label: this.label }`,
    `this.extra`,
    `Object.assign({}, this)`,
  ]);
  lines[7] = lines[7].replace("WHAT", what);
  const count = random.between(3, 6);
  const names: string[] = [];
  const kinds: string[] = [];
  for (let v = 0; v < count; v++) {
    const kind = random.pick([
      "holder",
      "holder",
      "pair",
      "node",
      "telling",
      "list",
      "plain",
      "getter",
      "proxy",
      "map",
    ]);
    kinds.push(kind);
    names.push(`v${v}`);
    lines.push(
      kind === "holder"
        ? `const v${v} = holder("v${v}");`
        : kind === "pair"
          ? `const v${v} = pair();`
          : kind === "node"
            ? `const v${v} = new Node("v${v}");`
            : kind === "telling"
              ? `const v${v} = new Telling("v${v}");`
              : kind === "list"
                ? `const v${v}: unknown[] = [1, "two"];`
                : kind === "plain"
                  ? `const v${v}: any = { a: 1, toJSON: undefined };`
                  : kind === "getter"
                    ? `let behind${v}: unknown = 1;\nconst v${v} = { id: ${v}, get read() { ran("get v${v}"); return behind${v}; } };`
                    : kind === "proxy"
                      ? `const target${v}: Record<string, unknown> = { a: 1 };\nconst v${v} = new Proxy(target${v}, { get(target, key, receiver) { if (typeof key === "string") ran("trap get v${v}." + key); return Reflect.get(target, key, receiver); }, ownKeys(target) { ran("trap keys v${v}"); return Reflect.ownKeys(target); } });`
                      : `const v${v}: Record<string, unknown[]> = { first: [], second: [] };`,
    );
  }
  const other = () => random.pick(names);
  for (let link = random.between(2, 8); link > 0; link--) {
    const v = random.below(count),
      n = names[v],
      o = random.chance(0.35) ? n : other();
    const same = (kind: string) =>
      names.filter((_, index) => kinds[index] === kind || (kind === "node" && kinds[index] === "telling"));
    const k = kinds[v];
    lines.push(
      k === "holder"
        ? random.pick([
            `${n}.self = ${random.pick(same("holder"))};`,
            `${n}.list.push(${random.pick(same("holder"))});`,
            `${n}.any = ${o};`,
            `${n}.maybe = ${random.pick(same("holder"))};`,
            `${n}.any = [${o}];`,
            `${n}.any = { deep: { deeper: ${o} } };`,
          ])
        : k === "pair"
          ? random.pick([
              `${n}.left = ${random.pick(same("pair"))};`,
              `${n}.right = ${random.pick(same("pair"))};`,
              `${n}.right = { text: "leaf", size: 4 };`,
            ])
          : k === "node" || k === "telling"
            ? random.pick([
                `${n}.next = ${random.pick(same("node"))};`,
                `${n}.items.push(${random.pick(same("node"))});`,
                `${n}.extra = ${o};`,
                `${n}.extra = [${o}, ${other()}];`,
              ])
            : k === "list"
              ? random.pick([`${n}.push(${o});`, `${n}[0] = ${o};`, `${n}.push([${o}]);`, `${n}.push({ in: ${o} });`])
              : k === "plain"
                ? random.pick([
                    `${n}.b = ${o};`,
                    `${n}.toJSON = function () { ran("toJSON ${n}"); return ${random.pick([o, `{ b: this.b }`, `1`, `[this.b]`])}; };`,
                    `${n}[${link}] = ${o};`,
                  ])
                : k === "getter"
                  ? `behind${v} = ${random.pick([o, `[${o}]`, `{ back: ${o} }`])};`
                  : k === "proxy"
                    ? `target${v}.${random.pick(["b", "a", "c"])} = ${o};`
                    : `${n}.${random.pick(["first", "second"])}.push(${o});`,
    );
  }
  const replacers = [
    ``,
    ``,
    ``,
    `, null, 1`,
    `, (key: string, value: unknown) => { ran("replacer " + key); return value; }`,
    `, ["name", "self", "label", "next", "a", "b", "left"]`,
    `, function (this: any, key: string, value: unknown) { ran("replacer " + key); return key === "any" || key === "extra" ? this : value; }`,
    `, (key: string, value: unknown) => (typeof value === "number" ? (ran("number " + key), ${other()}) : value)`,
  ];
  lines.push(
    `function write(name: string, make: () => string | undefined) {`,
    `  order.length = 0;`,
    `  for (const key in counts) delete counts[key];`,
    `  let told: string;`,
    `  try { const text = make(); told = text === undefined ? "undefined" : text.length > 300 ? text.length + " characters" : text; } catch (error) { told = "threw " + (error as Error).name; }`,
    `  console.log(name, told);`,
    `  console.log(" counts", JSON.stringify(counts));`,
    `  console.log(" order", order.join(", "));`,
    `}`,
  );
  for (let w = random.between(3, 8); w > 0; w--) {
    const n = other();
    const subject = random.pick([
      n,
      n,
      n,
      `[${n}]`,
      `{ top: ${n} }`,
      `[${n}, ${other()}]`,
      `{ a: ${n}, b: ${other()} }`,
    ]);
    const call = `JSON.stringify(${subject}${random.pick(replacers)})`;
    lines.push(
      random.chance(0.2)
        ? `for (let turn = 0; turn < 3; turn++) write("${n} turn " + turn, () => ${call});`
        : `write("${n}", () => ${call});`,
    );
  }
  return lines.join("\n") + "\n";
}
