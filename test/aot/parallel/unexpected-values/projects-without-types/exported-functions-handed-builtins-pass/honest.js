import { labelled, noted, parsed, scaled, sizeOf, total } from "./library.js";

export function honest() {
  return [scaled(2), scaled(2, 3), labelled(1), labelled(1, "n"), sizeOf([1, 2]), noted(1, 2), total(1, 2), parsed("10", 10)];
}
