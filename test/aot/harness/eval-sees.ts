// Every kind of binding, met by every small deed of a direct eval, in strict and in sloppy code: what the evaluated text sees, and what the
// code around it sees afterwards. The text is written out, or comes from a call, so that the build cannot read it.
import type { Cell } from "./cells";

// `$` stands for the eval and what follows it.
const bindings: Record<string, string> = {
  var: `var x = 1; $`,
  let: `let x = 1; $`,
  const: `const x = 1; $`,
  parameter: `return (function (x) { $ })(1);`,
  "parameter with a default": `return (function (x = 1) { $ })();`,
  rest: `return (function (...x) { $ })(1);`,
  "taken apart": `let { x } = { x: 1 }; $`,
  caught: `try { throw 1; } catch (x) { $ }`,
  "of a loop": `for (let x = 1; x < 2; x++) { $ }`,
  function: `function x() { return 1; } $`,
  class: `class x { static v = 1; } $`,
  captured: `let x = 1; const read = () => x; $ log("read " + text(read()));`,
  "of the function around": `let x = 1; (function () { $ })(); log("around " + text(x));`,
  "of an arrow around": `let x = 1; (() => { $ })(); log("around " + text(x));`,
  "behind a yield": `const it = (function* () { let x = 1; yield 0; $ })(); it.next(); it.next();`,
  "in a block": `{ let x = 1; { $ } }`,
  "shadowed": `let x = 0; { let x = 1; $ } log("outer " + text(x));`,
  "not yet initialized": `{ $ let x = 1; }`,
  none: `$`,
};

const deeds: Record<string, string> = {
  read: `x`,
  write: `x = 5`,
  add: `x++`,
  "another kind": `x += "s"`,
  typeof: `typeof x`,
  delete: `delete x`,
  "a reader": `() => x`,
  "a writer": `v => { x = v; }`,
  "var of the name": `var x = 9; x`,
  "let of the name": `let x = 9; x`,
  "function of the name": `function x() { return 9; } typeof x`,
  "a new var": `var fresh = 3; fresh`,
  "nested eval": `eval("x = 6")`,
  arguments: `typeof arguments === "object" ? arguments.length : "none"`,
  this: `typeof this`,
};

const ways: Record<string, (source: string) => string> = {
  written: source => `eval(${JSON.stringify(source)})`,
  handed: source => `eval(tag(${JSON.stringify(source)}))`,
  indirect: source => `(0, eval)(${JSON.stringify(source)})`,
};

export const helpers = `globalThis.log = log;
globalThis.tag = v => v;
globalThis.text = v => typeof v === "function" ? "function" : typeof v + ":" + (/^(function|class)\\b/.test(String(v)) ? "the text of a function" + String(v).slice(-1) : String(v));
`;
export const call = `try { run(); } catch (e) { log("threw " + e.name); }`;

export function cells(): Cell[] {
  const all: Cell[] = [];
  for (const mode of ["strict", "sloppy"])
    for (const [binding, around] of Object.entries(bindings))
      for (const [deed, source] of Object.entries(deeds))
        for (const [way, evaluated] of Object.entries(ways)) {
          if (mode === "strict" && deed === "delete" && way === "written") continue;
          const id = "v" + (all.length + 1);
          const inside = `let got; try { got = ${evaluated(source)}; log("gave " + text(got)); } catch (e) { log("!" + e.name); } try { log("sees " + text(x)); } catch (e) { log("sees !" + e.name); } try { log("fresh " + typeof fresh); } catch (e) { log("fresh !" + e.name); } ${binding === "const" ? "" : `try { x = 7; } catch (e) { log("store !" + e.name); }`} if (typeof got === "function") { try { log("called " + text(got(8))); log("then " + text(x)); } catch (e) { log("called !" + e.name); } }`;
          const body = around.replace("$", () => inside);
          all.push(
            mode === "strict"
              ? { id, what: `${mode} | ${binding} | ${deed} | ${way}`, text: `function ${id}() { ${body} }` }
              : {
                  id,
                  what: `${mode} | ${binding} | ${deed} | ${way}`,
                  text: `import ${id} from "./${id}/cell.cjs";`,
                  files: { "cell.cjs": `module.exports = function () { ${body} };\n` },
                },
          );
        }
  return all;
}
