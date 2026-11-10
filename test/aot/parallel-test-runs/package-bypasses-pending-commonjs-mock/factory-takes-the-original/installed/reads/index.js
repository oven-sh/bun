import dep, { kind } from "dep";
import * as space from "dep";
const show = () => { try { return dep.value() + ":" + kind + ":" + Object.keys(space).sort().join("+"); } catch (e) { return e.name; } };
export const seen = show;
