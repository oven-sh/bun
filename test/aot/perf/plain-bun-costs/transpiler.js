let text = "import { a as b } from './x';\nexport enum Color { Red, Green = 4, Blue }\n";
for (let i = 0; i < 400; i++)
  text += `export interface I${i}<T> { value: T; next?: I${i}<T> }\nexport class C${i}<T extends object> implements I${i}<T> { private count = ${i}; constructor(public value: T, readonly name: string = \`n\${${i}}\`) {} get size(): number { return this.count ?? 0; } async load(this: C${i}<T>, ...rest: number[]): Promise<number> { const { x = 1, ...others } = { x: rest[0], y: 2 } as const; for await (const n of rest) if (n > x) return n satisfies number; return others.y!; } }\nexport function f${i}<K extends keyof any>(k: K, o?: Record<K, number>): number { return (o?.[k] ?? ${i}) ** 2 + (b as number); }\nconst e${i} = <div className="c${i}" {...{ id: ${i} }}>{f${i}("k")}<span>text &amp; more</span></div>;\n`;
const transpiler = new Bun.Transpiler({ loader: "tsx", target: "bun" });
let sum = 0;
for (let round = 0; round < 6; round++) sum += transpiler.transformSync(text).length + transpiler.scan(text).exports.length;
sum += new Bun.Transpiler({ loader: "tsx", minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: true }).transformSync(text).length;
console.log(sum);
