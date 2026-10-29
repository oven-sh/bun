import flagged, { named } from "./flagged.cjs";
import * as namespace from "./flagged.cjs";
export const seen = [flagged, named, Object.keys(namespace), namespace.default];
