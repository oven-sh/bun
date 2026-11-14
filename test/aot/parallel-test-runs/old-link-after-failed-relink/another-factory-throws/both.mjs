import { member as inner } from "./user.mjs";
import { beside } from "./beside.mjs";
export const member = () => inner() + " " + beside;
