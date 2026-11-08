// Second family: three declarations in chains, nested blocks, mutual recursion, hooks, other escapes.
import fs from "node:fs";
const EARLY = {
  none: "",
  callC: "const v0 = third();",
  callS: "const v0 = sibling();",
  deadH: "const unused = () => helper();",
  deadHcallC: "const unused = () => helper(); const v0 = third();",
  deadScallC: "const unused = () => sibling(); const v0 = third();",
  closureC: "const cb0 = () => third();",
  stateC: "const [v0] = useState(third);",
  memoC: "const v0 = useMemo(() => third(), [p.a, p.b]);",
  ifCallC: "let v0 = 0; if (p.a > 1) { v0 = third(); }",
  mapC: "const v0 = [1, 2].map(() => third()).join();",
};
// helper <- sibling <- third
const BODIES = {
  chain: ["return p.a;", "return helper() + 1;", "return sibling() + 1;"],
  thirdCallsBoth: ["return p.a;", "return p.b;", "return helper() + sibling();"],
  mutual: ["return p.a > 1 ? sibling() : 0;", "return p.a;", "return helper() + 1;"],
  selfRec: ["return p.a;", "return p.a > 5 ? sibling() : helper();", "return sibling();"],
};
const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const NAMES = ["helper", "sibling", "third"];
const USE = {
  escH: v => `return <button onClick={helper}>{${v}}</button>;`,
  escS: v => `return <button onFocus={sibling}>{${v}}</button>;`,
  escC: v => `return <button onClick={third}>{${v}}</button>;`,
  escObj: v => `const api = { helper, third }; return <button onClick={api.helper} onFocus={api.third}>{${v}}</button>;`,
  callAfter: v => `const w = third(); return <button>{w}{${v}}</button>;`,
};
const WRAP = {
  flat: body => body,
  inIf: body => `if (p.a) { ${body} } return null;`,
};
let src = `import { useState, useEffect, useMemo } from "react";\n`;
let n = 0;
for (const [en, e] of Object.entries(EARLY))
  for (const [bn, bodies] of Object.entries(BODIES))
    for (const perm of perms)
      for (const [un, use] of Object.entries(USE))
        for (const [wn, wrap] of Object.entries(WRAP)) {
          const name = `G_${en}_${bn}_${perm.join("")}_${un}_${wn}`;
          const v = /\bv0\b/.test(e) ? "v0" : /cb0/.test(e) ? "cb0()" : "p.a";
          const decls = perm.map(i => `function ${NAMES[i]}() { ${bodies[i]} }`).join(" ");
          src += `export function ${name}(p) { ${wrap(`${e} ${decls} ${use(v)}`)} }\n`;
          n++;
        }
fs.writeFileSync("forms.jsx", src);
console.log(n);
