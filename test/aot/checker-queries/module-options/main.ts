// Each file is checked with the module options of the nearest tsconfig.json: `inner/` has `verbatimModuleSyntax` and `isolatedModules`, `main.ts` has neither.
import { Shape } from "./shape.ts";
import { width } from "./inner/index.ts";
const shape: Shape = { width: 1 };
width(shape);
