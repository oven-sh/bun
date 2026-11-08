// Hoisted function declarations: early references x declaration orders x bodies x uses.
import fs from "node:fs";
const EARLY = {
  none: "",
  deadClosureH: "const unused = () => helper();",
  deadClosureS: "const unused = () => sibling();",
  deadClosureBoth: "const unused = () => { helper(); sibling(); };",
  callS: "const v0 = sibling();",
  callH: "const v0 = helper();",
  deadHcallS: "const unused = () => helper(); const v0 = sibling();",
  deadBranchH: "const dev = false; if (dev) helper();",
  deadBranchHcallS: "const dev = false; if (dev) helper(); const v0 = sibling();",
  liveClosureS: "const cb0 = () => sibling();",
  stateS: "const [v0] = useState(sibling);",
  effectS: "useEffect(() => { p.log(sibling()); });",
  removedCatchH: "try { const limit = 3; } catch (e) { helper(e); }",
  removedCatchHcallS: "try { const limit = 3; } catch (e) { helper(e); } const v0 = sibling();",
  memoS: "const v0 = useMemo(() => sibling(), [p.a]);",
};
const HBODY = { plain: "return p.a;", usesB: "return p.a + p.b;" };
const SBODY = { callsH: "return helper();", callsHplus: "return helper() + 1;", noH: "return p.b;" };
const ORDER = {
  HS: (h, s) => `${h} ${s}`,
  SH: (h, s) => `${s} ${h}`,
  HmidS: (h, s) => `${h} const mid = p.b + 1; ${s}`,
  SmidH: (h, s) => `${s} const mid = p.b + 1; ${h}`,
};
const USE = {
  escH: v => `return <button onClick={helper}>{${v}}</button>;`,
  escS: v => `return <button onFocus={sibling}>{${v}}</button>;`,
  escBoth: v => `return <button onClick={helper} onFocus={sibling}>{${v}}</button>;`,
  callAfter: v => `const w = helper() + sibling(); return <button>{w}{${v}}</button>;`,
  escHcallAfter: v => `const w = sibling(); return <button onClick={helper}>{w}{${v}}</button>;`,
  none: v => `return <button>{${v}}</button>;`,
};
let src = `import { useState, useEffect, useMemo } from "react";\n`;
const names = [];
for (const [en, e] of Object.entries(EARLY))
  for (const [hn, hb] of Object.entries(HBODY))
    for (const [sn, sb] of Object.entries(SBODY))
      for (const [on, order] of Object.entries(ORDER))
        for (const [un, use] of Object.entries(USE)) {
          const name = `F_${en}_${hn}_${sn}_${on}_${un}`;
          const v = /\bv0\b/.test(e) ? "v0" : /cb0/.test(e) ? "cb0()" : "p.a";
          names.push(name);
          src += `export function ${name}(p) { ${e} ${order(`function helper() { ${hb} }`, `function sibling() { ${sb} }`)} ${use(v)} }\n`;
        }
fs.writeFileSync("forms.jsx", src);
fs.writeFileSync("names.json", JSON.stringify(names));
console.log(names.length);
