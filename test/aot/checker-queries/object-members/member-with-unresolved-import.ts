// A member whose type does not resolve gives up by itself. The other members of the object have their types.
import type { Missing } from "./no-such-file";
interface Holder { bad: Missing; good: number; list: string[] }
declare const holder: Holder;
holder.bad;
holder.good;
holder.list;
