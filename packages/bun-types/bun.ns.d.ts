// Import via a `:`-containing specifier so TypeScript treats it as a URI and
// skips file-based resolution — otherwise `"bun"` can land on the empty
// `@types/bun` stub instead of the ambient `declare module "bun"`. See #30503.
import * as BunModule from "bun-types:internal";

declare global {
  export import Bun = BunModule;
}
