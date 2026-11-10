import type { Case } from "./cases.ts";
const tail = `@layer b { .t { color: green } }\n`;
const g = `@layer a { .t { color: red } }`;
const entry = `@import "./f.css";\n@import "./g.css";\n@import "./f.css";\n` + tail;
export const cases: Record<string, Case> = {
  c3_media: { files: { "entry.css": entry, "f.css": `@media print { @layer b { .p { color: red } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_supports: { files: { "entry.css": entry, "f.css": `@supports (bogus-prop: 1px) { @layer b { .p { color: red } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_moz_document: { files: { "entry.css": entry, "f.css": `@-moz-document url-prefix() { @layer b { .p { color: red } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_nested_conditions: { files: { "entry.css": entry, "f.css": `@media screen { @supports (bogus-prop: 1px) { @layer b { .p { color: red } } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_statement: { files: { "entry.css": entry, "f.css": `@media print { @layer b; }`, "g.css": g }, probes: ["t", "p"] },
  c3_empty_block: { files: { "entry.css": entry, "f.css": `@media print { @layer b {} }`, "g.css": g }, probes: ["t", "p"] },
  c3_inside_named_layer: {
    files: {
      "entry.css": `@import "./f.css";\n@import "./g.css";\n@import "./f.css";\n@layer o { @layer b { .t { color: green } } }\n`,
      "f.css": `@layer o { @media print { @layer b { .p { color: red } } } }`,
      "g.css": `@layer o { @layer a { .t { color: red } } }`,
    },
    probes: ["t", "p"],
  },
  c3_inside_style_rule: { files: { "entry.css": entry, "f.css": `.x { @media print { @layer b { color: red } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_also_declared_later: {
    files: {
      "entry.css": `@import "./f.css";\n@import "./g.css";\n@import "./f.css";\n@layer c { .t { color: red } }\n@layer b { .t { color: green } }\n`,
      "f.css": `@media print { @layer b { .p { color: red } } }\n@layer c, b;`,
      "g.css": `.u { color: blue }`,
    },
    probes: ["t", "p"],
  },
  c3_media_not_all: { files: { "entry.css": entry, "f.css": `@media not all { @layer b { .p { color: red } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_copy_under_media: {
    files: { "entry.css": `@import "./f.css" screen;\n@import "./g.css";\n@import "./f.css" screen;\n` + tail, "f.css": `@supports (bogus-prop: 1px) { @layer b { .p { color: red } } }`, "g.css": g },
    probes: ["t", "p"],
  },
  c3_in_bare_layer: {
    files: { "entry.css": `@import "./a.css" layer;\n`, "a.css": entry, "f.css": `@media print { @layer b { .p { color: red } } }`, "g.css": g },
    probes: ["t", "p"],
  },
  c3_behind_pre_import_statement: {
    files: { "entry.css": entry, "f.css": `@layer x;\n@import "./h.css";\n@media print { @layer b { .p { color: red } } }`, "g.css": g, "h.css": `.h { color: blue }` },
    probes: ["t", "p"],
  },
  c3_three_copies: {
    files: {
      "entry.css": `@import "./f.css";\n@import "./g.css";\n@import "./f.css";\n@import "./h.css";\n@import "./f.css";\n` + tail,
      "f.css": `@media print { @layer b { .p { color: red } } }`,
      "g.css": g,
      "h.css": `@layer c { .t { color: red } }`,
    },
    probes: ["t", "p"],
  },
  c3_list_behind_skeleton: {
    files: {
      "entry.css": `@import "./f.css";\n@import "./f2.css";\n@import "./g.css";\n@import "./f.css";\n@import "./f2.css";\n`,
      "f.css": `@media print { @layer b { .p { color: red } } }`,
      "f2.css": `@layer b { .t { color: red } }`,
      "g.css": `@layer a { .t { color: green } }`,
    },
    probes: ["t", "p"],
  },
  c3_pin_adjacent_copies: { files: { "entry.css": `@import "./f.css";\n@import "./f.css";\n@import "./g.css";\n` + tail, "f.css": `@media print { @layer b { .p { color: red } } }`, "g.css": g }, probes: ["t", "p"] },
  c3_pin_container: { files: { "entry.css": entry, "f.css": `@container (min-width: 99999px) { @layer b { .p { color: red } } }`, "g.css": `@layer a { .t { color: green } }` }, probes: ["t", "p"] },
  c3_pin_unconditional_first: {
    files: { "entry.css": entry, "f.css": `@layer b { .q { color: red } }\n@media print { @layer b { .p { color: red } } }`, "g.css": `@layer a { .t { color: green } }` },
    probes: ["t", "p"],
  },
};
