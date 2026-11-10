import { member as inner } from "./user.mjs";
import { nothing } from "./last.mjs";
export const member = () => inner() + String(nothing);
