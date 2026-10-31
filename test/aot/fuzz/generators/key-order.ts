// The order of the keys of objects of declared types that also get properties their type does not declare. Records and classes with optional
// fields, and a random walk: an optional field is created, a property beyond the type is added (through `any`), one of either kind is deleted and
// comes again, an index, a symbol. After the walk: Object.keys, for-in, JSON.stringify, Object.entries, Reflect.ownKeys, the keys of a spread copy
// and of Object.assign's. Many walks share their beginnings and part late, and there are more shapes than a small table holds. Each walk is a
// function of its own and runs three times, the third behind a collection.
//
// A program is a seed. The same seed always writes the same program.
import { randomFrom } from "./constant-expressions";

const helpers = `const unknown = <T,>(x: T): T => x;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const S = Symbol("s");
const told = (o: object): string => { const forIn: string[] = []; for (const k in o) forIn.push(k); return [Object.keys(o).join(), forIn.join(), JSON.stringify(o), Object.entries(o).map(([k, v]) => k + "=" + String(v)).join(), Reflect.ownKeys(o).map(String).join(), Object.keys({ ...o }).join(), Object.keys(Object.assign({}, o)).join()].join(" # "); };
const say = (label: string, f: () => object): void => { const all: string[] = []; for (let i = 0; i < 3; i++) { if (i === 2) collect(); let r: string; try { r = told(f()); } catch (e) { r = "throws " + (e as Error).constructor.name; } all.push(r); } console.log(label + " ==> " + (all[0] === all[1] && all[1] === all[2] ? all[0] : all.join(" THEN "))); };`;

export function program(seed: number): { file: string; text: string } {
  const { next, choice, upTo } = randomFrom(seed);
  const lines = ["declare const gc: undefined | (() => void);", helpers];
  const types = Array.from({ length: 8 }, (_, t) => {
    const required = Array.from({ length: upTo(0, 3) }, (_, i) => "r" + i);
    const optional = Array.from({ length: upTo(2, 6) }, (_, i) => "o" + i);
    const kind = choice(["type", "interface", "class", "class"] as const);
    const fields = required.map(f => ` ${f}: number;`).join("") + optional.map(f => ` ${f}?: number;`).join("");
    if (kind === "type") lines.push(`type T${t} = {${fields} };`);
    else if (kind === "interface") lines.push(`interface T${t} {${fields} }`);
    else lines.push(`class T${t} {${required.map((f, i) => ` ${f} = ${i + 1};`).join("")}${optional.map(f => ` ${f}?: number;`).join("")} }`);
    return { kind, required, optional };
  });
  let n = 0;
  for (let group = 0; group < 60; group++) {
    const t = upTo(0, types.length - 1);
    const { kind, required, optional } = types[t];
    const beyond = Array.from({ length: upTo(1, 5) }, (_, i) => "x" + i);
    const step = () => {
      const k = next();
      if (k < 0.38) return `o.${choice(optional)} = ${upTo(1, 9)};`;
      if (k < 0.7) return `(o as any).${choice(beyond)} = ${upTo(1, 9)};`;
      if (k < 0.78) return `delete o.${choice(optional)};`;
      if (k < 0.86) return `delete (o as any).${choice(beyond)};`;
      if (k < 0.9) return `(o as any)[${choice([0, 1, 7, 100])}] = 0;`;
      if (k < 0.93) return "(o as any)[S] = 0;";
      if (k < 0.96) return `(o as any)[unknown("${choice(beyond)}")] = ${upTo(1, 9)};`;
      return "Object.keys(o);";
    };
    const head = Array.from({ length: upTo(1, 6) }, step);
    for (let variant = 0; variant < 8; variant++) {
      n++;
      const walk = [...head, ...Array.from({ length: upTo(1, 7) }, step)].join(" ");
      const made = kind === "class" ? `new T${t}()` : `{${required.map((f, i) => ` ${f}: ${i + 1}`).join(",")} }`;
      lines.push(`function w${n}(): object { const o: T${t} = ${made}; ${walk} return o; } say(${JSON.stringify(`T${t} ${kind} | walk ${n} | ${walk}`)}, w${n});`);
    }
  }
  return { file: "main.ts", text: lines.join("\n") + "\n" };
}
