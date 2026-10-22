// Each file is checked with the module options of the nearest tsconfig.json: `inner/` has `verbatimModuleSyntax` and `isolatedModules`, `main.ts` has neither.
import { Shape } from "./shape.ts";
import type { Declared } from "./types";
export function width(shape: Shape): number { return shape.width; }
