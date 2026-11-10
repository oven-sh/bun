import type { Case } from "./cases.ts";
export const cases: Record<string, Case> = {
  c8_same_layer_on_both: {
    files: { "entry.css": `@import "./a.css" layer(w);\n@import "EXT/ext.css" layer(w);\n`, "a.css": `@layer inner { .t { color: red } }` },
    external: { "ext.css": `@layer other { .t { color: green } }` },
  },
  c8_named_layer_before_bare_layer_external: {
    files: { "entry.css": `@import "./a.css";\n@import "EXT/ext.css" layer;\n`, "a.css": `@layer y { .t { color: red } }` },
    external: { "ext.css": `.t { color: green }` },
  },
  c8_statement_behind_earlier_file: {
    files: {
      "entry.css": `@import "./a.css";\n@import "./b.css";\n@layer z { .t { color: green } }\n@layer x { .t { color: red } }\n`,
      "a.css": `.u { color: blue }`,
      "b.css": `@layer x;\n@import "EXT/ext.css" layer(z);\n`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  c8_file_under_media_with_own_layer: {
    files: { "entry.css": `@import "./a.css" screen;\n@import "EXT/ext.css" layer(z);\n@layer z { .t { color: green } }\n@layer y { .t { color: red } }\n`, "a.css": `@layer y { .u { color: blue } }` },
    external: { "ext.css": `.u { color: blue }` },
  },
  c8_closed_conditional_then_plain: {
    files: {
      "entry.css": `@import "./a.css";\n@import "./b.css";\n@import "EXT/ext.css" layer(z);\n@layer z { .t { color: green } }\n@layer y { .t { color: red } }\n`,
      "a.css": `@media screen { @layer q { .u { color: blue } } }`,
      "b.css": `@layer y { .u { color: blue } }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  c8_closed_anonymous_block_then_plain: {
    files: {
      "entry.css": `@import "./a.css";\n@import "./b.css";\n@import "EXT/ext.css" layer(z);\n@layer z { .t { color: green } }\n@layer y { .t { color: red } }\n`,
      "a.css": `@layer { .u { color: blue } }`,
      "b.css": `@layer y { .u { color: blue } }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  c8_closed_bare_layer_import_then_plain: {
    files: {
      "entry.css": `@import "./a.css" layer;\n@import "./b.css";\n@import "EXT/ext.css" layer(z);\n@layer z { .t { color: green } }\n@layer y { .t { color: red } }\n`,
      "a.css": `.u { color: blue }`,
      "b.css": `@layer y { .u { color: blue } }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  c8_tailwind_statement_then_layered_external: {
    files: {
      "entry.css": `@import "./tw.css";\n@import "EXT/ext.css" layer(vendor);\n@layer vendor { .t { color: red } }\n@layer utilities { .t { color: green } }\n`,
      "tw.css": `@layer theme, base, components, utilities;\n@import "./base.css" layer(base);\n@layer utilities { .u { color: blue } }`,
      "base.css": `.u { color: blue }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
};
