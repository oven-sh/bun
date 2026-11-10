import type { Case } from "./cases.ts";
export const cases: Record<string, Case> = {
  // css/CSSAtLayerOrderConditionalImportOfACycleAheadOfAStatement, with rules that show the order of z, x and y
  c6_cycle_ahead_of_statement: {
    files: {
      "entry.css": `@import "./entry.css" layer(z) screen;\n@import "./a.css";\n@layer y { .t { color: green } }\n@layer x { .t { color: red } }\n@layer z { .t { color: red } }\n`,
      "a.css": `@layer x;\n@import "EXT/e.css" layer(y);\n.a { c: d }\n`,
    },
    external: { "e.css": `.u { color: blue }` },
  },
  // css/CSSImportPrologueStatementUnderConditionsBeforeExternalImport
  c6_statement_under_conditions: {
    files: {
      "entry.css": `@import "./mid.css" layer(wrap) supports(display: flex);\n@layer wrap { @layer other { .t { color: green } } @layer inner { .t { color: red } } }\n`,
      "mid.css": `@layer inner;\n@import "EXT/e.css";\n`,
    },
    external: { "e.css": `@layer other { .u { color: blue } }` },
  },
  // css/CSSAtLayerOrderConditionalImportsBehindAnUnknownAtRule
  c6_behind_unknown_at_rule: {
    files: {
      "entry.css": `@unknown x;\n@import "./b.css" layer(x) supports(display: grid) screen;\n@import "EXT/e.css" layer(y) print;\n.a { c: d }\n@layer y { .t { color: green } }\n@layer x { .t { color: red } }\n`,
      "b.css": `.b { c: d }`,
    },
    external: { "e.css": `.u { color: blue }` },
  },
};
