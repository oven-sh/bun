// Which comments of one TSX source a minified parse without lint lists: "listed" = its text is taken out of the character frequency.
const z = "z".repeat(400);
const template = i => {
  const c = n => (n === i ? `/* ${z} */` : `/*${n}*/`);
  const l = n => (n === i ? `// ${z}` : `// ${n}`);
  return `export function f(){ let longName = 1; let e = <div ${c(1)} id="x" ${l(2)}\n>{${c(3)} longName}</div ${c(4)} >; ${c(5)}\nclass F { [k: string = "a" ${c(6)} ] ${c(7)} : number ${c(8)} ; }\nclass G { [k: string]: { [a ${c(9)} + b]: 1 } ${c(10)} ; } return [e, F, G, longName]; }`;
};
const out = [];
for (let i = 0; i <= 10; i++) {
  try {
    const t = new Bun.Transpiler({ loader: "tsx", minify: { identifiers: true }, target: "browser" });
    const o = t.transformSync(template(i));
    const m = o.match(/let (\w+)\s*=\s*1/);
    out.push(`${i}:${m ? (m[1] === "z" ? "not-listed" : "listed(" + m[1] + ")") : "?"}`);
  } catch (e) { out.push(`${i}:ERR ${String(e.message).slice(0, 60)}`); }
}
console.log(Bun.revision.slice(0, 10), out.join(" "));
