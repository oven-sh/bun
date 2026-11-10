import type { Case } from "./cases.ts";
const tail = `@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`;
export const cases: Record<string, Case> = {
  c7_file_under_supports: {
    files: { "entry.css": `@import "./f.css" layer(w) supports(display: grid);\n@import "EXT/ext.css" layer(v);\n` + tail, "f.css": `.u { color: blue }` },
    external: { "ext.css": `.u { color: blue }` },
  },
  c7_file_between_external_imports: {
    files: { "entry.css": `@import "EXT/one.css" layer(a);\n@import "./f.css" layer(w);\n@import "EXT/ext.css" layer(v);\n` + tail, "f.css": `.u { color: blue }` },
    external: { "one.css": `.u { color: blue }`, "ext.css": `.u { color: blue }` },
  },
  c7_file_before_external_with_bare_layer: {
    files: { "entry.css": `@import "./f.css" layer(w);\n@import "EXT/ext.css" layer;\n`, "f.css": `.t { color: red }` },
    external: { "ext.css": `.t { color: green }` },
  },
  c7_sublayer_before_external_in_its_layer: {
    files: { "entry.css": `@import "./f.css" layer(w.inner);\n@import "EXT/ext.css" layer(w);\n`, "f.css": `.t { color: red }` },
    external: { "ext.css": `@layer other { .t { color: green } }` },
  },
  c7_file_before_external_in_its_sublayer: {
    files: { "entry.css": `@import "./f.css" layer(w);\n@import "EXT/ext.css" layer(w.inner);\n`, "f.css": `.t { color: green }` },
    external: { "ext.css": `.t { color: red }` },
  },
  c7_two_files: {
    files: {
      "entry.css": `@import "./f.css" layer(a) screen;\n@import "./g.css" layer(b);\n@import "./f.css" layer(a) screen;\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer b { .t { color: red } }\n@layer a { .t { color: red } }\n`,
      "f.css": `.u { color: blue }`,
      "g.css": `.u { color: blue }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  c7_closed_two_media: {
    files: { "entry.css": `@import "./mid.css" screen;\n@import "EXT/ext.css" layer(v);\n` + tail, "mid.css": `@import "./f.css" layer(w) (min-width: 1px);`, "f.css": `.u { color: blue }` },
    external: { "ext.css": `.u { color: blue }` },
  },
  c7_closed_anonymous_layer: {
    files: { "entry.css": `@import "./f.css" layer;\n@import "./g.css" layer(w);\n@import "EXT/ext.css" layer(v);\n` + tail, "f.css": `.u { color: blue }`, "g.css": `.u { color: blue }` },
    external: { "ext.css": `.u { color: blue }` },
  },
  c7_js_like_two_sheets: {
    // What the CSS of a JS entry that imports a.css and then b.css is: one order from both.
    files: { "entry.css": `@import "./a.css";\n@import "./b.css";\n`, "a.css": `@import "./rules.css" layer(w);`, "rules.css": `.t { color: red }`, "b.css": `@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n` },
    external: { "ext.css": `.u { color: blue }` },
  },
};
