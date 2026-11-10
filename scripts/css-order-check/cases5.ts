import type { Case } from "./cases.ts";
export const cases: Record<string, Case> = {
  c5_bare_layer_after_named_layer_fonts: {
    files: {
      "entry.css": `@import "./x.css";\n@import "./a.css" layer;\n`,
      "x.css": `@layer q { .t { color: red } }`,
      "a.css": `@import "EXT/fonts.css";\n.t { color: green }\n`,
    },
    external: { "fonts.css": `@font-face { font-family: F; src: local(Arial) }` },
  },
  c5_reset_then_fonts: {
    files: {
      "entry.css": `@import "./reset.css";\n@import "EXT/fonts.css";\n.t { color: green }\n`,
      "reset.css": `.t { color: red }`,
    },
    external: { "fonts.css": `@font-face { font-family: F; src: local(Arial) }` },
  },
  c5_tailwind_layers_then_fonts: {
    files: {
      "entry.css": `@import "./tw.css";\n@import "EXT/fonts.css";\n@layer base { .t { color: red } }\n@layer utilities { .t { color: green } }\n`,
      "tw.css": `@layer theme, base, components, utilities;\n@layer base { .u { color: blue } }`,
    },
    external: { "fonts.css": `@font-face { font-family: F; src: local(Arial) }` },
  },
};
