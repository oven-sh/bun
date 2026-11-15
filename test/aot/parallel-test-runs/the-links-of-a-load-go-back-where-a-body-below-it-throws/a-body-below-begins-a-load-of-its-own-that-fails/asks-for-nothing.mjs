import { member as inner } from "./named.mjs";
import { nothing } from "./last.mjs";
export const member = () => inner() + String(nothing);
