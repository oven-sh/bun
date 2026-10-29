import { basename, path, EOL } from "./node-reexport.mjs";
import * as namespace from "./node-reexport.mjs";
export const seen = [basename("/a/b.txt"), typeof path.join, typeof EOL, typeof namespace.basename, typeof namespace.platform, "default" in namespace];
