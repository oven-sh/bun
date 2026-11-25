import dep, { kind } from "dep";
import * as space from "dep";
export const seen = () => { try { return dep.value() + ":" + kind + ":" + Object.keys(space).sort().join("+"); } catch (e) { return e.name; } };
