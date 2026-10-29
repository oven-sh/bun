import { Flag } from "./flag";
import * as all from "./flag";
console.log(Flag.Both, Flag.Read | Flag.Write, all.Flag.Write, Object.keys(all).join());
