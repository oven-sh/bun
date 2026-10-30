// Company for the programs of a build: a module of classes, literals, constructor functions and chains that have nothing to do with them
// but hold the names they use, each with other kinds of values at other places. What the compiler expects of `o.x` goes by every shape of
// the whole program that has an `x`, and a small program alone never passes the limits of such lists.
//
//   bun test/aot/fuzz/company.ts 65 reduced.ts > company.js     # the company a finding was made in: `import "./company.js";` goes in front of it
import { readFileSync } from "fs";

const neverAField = new Set(["constructor", "prototype", "__proto__"]);

/** The names that the texts read, store or declare as members, the most used first. */
export function memberNames(texts: string[], most = 40): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) for (const [, name] of text.matchAll(/(?:\.|[{,]\s*)([A-Za-z_$][\w$]*)(?=\s*[:=(.,;)\]}\s?!+\-*/<>&|[])/g)) if (!neverAField.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1))
    .slice(0, most)
    .map(([name]) => name);
}

const valueOf = (kind: number, i: number, name: string) =>
  [`${i}`, `${i}.5`, `"s${i % 3}"`, `null`, `{ ${name}: ${i} }`, `[${i}]`, `${i % 2 === 0}`, `undefined`, `() => ${i}`, `${i}n`, `-0`, `[${i}.5, "t"]`, `{ own: { ${name}: "deep" } }`][kind % 13];

/** `size` shapes, no two alike, that hold `names`. The module prints nothing. */
export function company(size: number, names: string[]): string {
  const lines = [`const all = [];`];
  for (let i = 0; i < size; i++) {
    // Another order for each, and not all of the names: a name lies at another place in each shape, and is absent in some.
    const mine = names.map((_, j) => names[(j + i) % names.length]).filter((_, j) => (i + j) % 7 !== 3);
    const value = (j: number) => valueOf(i * 5 + j, i, mine[j]);
    switch (i % 6) {
      case 0:
        lines.push(`all.push({ own${i}: ${i}, ${mine.map((name, j) => `${name}: ${value(j)}`).join(", ")} });`);
        break;
      case 1:
        lines.push(`all.push(new (class C${i} { own${i} = ${i}; ${mine.map((name, j) => `${name} = ${value(j)};`).join(" ")} })());`);
        break;
      case 2:
        lines.push(`all.push(new (class P${i} { own${i} = ${i}; ${mine.map((name, j) => (j % 3 === 0 ? `${name}() { return ${value(j)}; }` : j % 3 === 1 ? `get ${name}() { return ${value(j)}; } set ${name}(v) { this.own${i} = v; }` : `${name} = ${value(j)};`)).join(" ")} })());`);
        break;
      case 3:
        lines.push(`all.push(new (function F${i}() { this.own${i} = ${i}; ${mine.map((name, j) => `this.${name} = ${value(j)};`).join(" ")} })());`);
        break;
      case 4:
        lines.push(`all.push(Object.assign(Object.create(all[${i - 1}]), { own${i}: ${i}, ${mine.filter((_, j) => j % 4 === 0).map((name, j) => `${name}: ${value(j)}`).join(", ")} }));`); // prettier-ignore
        break;
      default:
        lines.push(`{ const o = {}; ${mine.map((name, j) => `o.${name} = ${value(j)};`).join(" ")} o.own${i} = ${i}; all.push(o); }`);
    }
  }
  lines.push(
    `function touch(o) { return ${names.map(name => `(typeof o.${name}).length`).join(" + ") || "0"}; }`,
    `function put(o, v) { ${names.map(name => `o.${name} = v;`).join(" ")} }`,
    `let touched = 0;`,
    `for (let turn = 0; turn < 3; turn++) for (const o of all) touched += touch(o);`,
    `for (let i = 0; i < all.length; i += 7) put(all[i], [i, i + 0.5, "p", null, { p: i }][i % 5]);`,
    `for (const o of all) touched += touch(o);`,
    `export default touched;`,
  );
  return lines.join("\n") + "\n";
}

if (import.meta.main) process.stdout.write(company(Number(process.argv[2]), memberNames(process.argv.slice(3).map(path => readFileSync(path, "utf8")))));
