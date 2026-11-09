export type Case = {
  files: Record<string, string>;
  external?: Record<string, string>;
  probes?: string[];
  args?: string[];
  expectBuildError?: boolean;
};
export const cases: Record<string, Case> = {
  // Issue 48421, item 1
  item1a_unlayered: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css";\n`,
      "a.css": `.t { color: red }`,
    },
    external: { "ext.css": `.t { color: green }` },
  },
  item1b_named_layer: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css" layer(z);\n@layer z { .t { color: green } }\n`,
      "a.css": `@layer y { .t { color: red } }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  item1c_bare_layer: {
    files: {
      "entry.css": `@import "./a.css" layer;\n`,
      "a.css": `@import "EXT/ext.css";\n@layer w { .t { color: red } }\n`,
    },
    external: { "ext.css": `.t { color: green }` },
  },
  // item 2
  item2_asset_layer_condition: {
    files: {
      "entry.css": `@import "./a.svg" layer(w) screen;\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`,
      "a.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  item2_cycle_layer_condition: {
    files: {
      "entry.css": `@import "./entry.css" layer(w) screen;\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  item2_file_layer_condition: {
    files: {
      "entry.css": `@import "./a.css" layer(w) screen;\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`,
      "a.css": `.u { color: blue }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  // item 3
  item3_conditional_layer: {
    files: {
      "entry.css": `@import "./f.css";\n@import "./g.css";\n@import "./f.css";\n@layer b { .t { color: green } }\n`,
      "f.css": `@media print { @layer b { .p { color: red } } }`,
      "g.css": `@layer a { .t { color: red } }`,
    },
    probes: ["t", "p"],
  },
  // item 4
  item4_svg: {
    files: {
      "entry.css": `@import "./a.svg";\n.t { color: green }\n`,
      "a.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>`,
    },
  },
  item4_unknown_extension: {
    files: {
      "entry.css": `@import "./theme.foo";\n`,
      "theme.foo": `.t { color: green }`,
    },
  },

  // Siblings of items 1 and 2
  sib_import_layer_then_external_layer: {
    files: {
      "entry.css": `@import "./a.css" layer(w);\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`,
      "a.css": `.u { color: blue }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  sib_asset_layer_then_external_layer: {
    files: {
      "entry.css": `@import "./a.svg" layer(w);\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`,
      "a.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  sib_same_layer_reorder: {
    files: {
      "entry.css": `@import "./a.css" layer(z);\n@import "EXT/ext.css" layer(z);\n`,
      "a.css": `.t { color: red }`,
    },
    external: { "ext.css": `.t { color: green }` },
  },
  sib_layered_then_unlayered_external: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css";\n`,
      "a.css": `@layer y { .t { color: red } }`,
    },
    external: { "ext.css": `.t { color: green }` },
  },
  sib_unlayered_then_layered_external: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css" layer(z);\n`,
      "a.css": `.t { color: green }`,
    },
    external: { "ext.css": `.t { color: red }` },
  },
  sib_two_externals_layer_between: {
    files: {
      "entry.css": `@import "EXT/one.css" layer;\n@import "./a.css";\n@import "EXT/two.css" layer(z);\n`,
      "a.css": `@layer y { .t { color: red } }`,
    },
    external: { "one.css": `.t { color: blue }`, "two.css": `.t { color: green }` },
  },
  sib_conditional_external_layer: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css" layer(z) screen;\n@layer q { .t { color: blue } }\n@layer z { .t { color: green } }\n`,
      "a.css": `@layer y { .t { color: red } }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  sib_layer_in_media_then_external: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css" layer(z);\n@layer z { .t { color: green } }\n@layer y { .t { color: red } }\n`,
      "a.css": `@media screen { @layer y { .u { color: blue } } }`,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  sib_empty_file_layer_condition: {
    files: {
      "entry.css": `@import "./empty.css" layer(w) screen;\n@import "EXT/ext.css" layer(v);\n@layer v { .t { color: green } }\n@layer w { .t { color: red } }\n`,
      "empty.css": ``,
    },
    external: { "ext.css": `.u { color: blue }` },
  },
  sib_important_unlayered: {
    files: {
      "entry.css": `@import "./a.css";\n@import "EXT/ext.css";\n`,
      "a.css": `.t { color: red !important }`,
    },
    external: { "ext.css": `.t { color: green !important }` },
  },
};
