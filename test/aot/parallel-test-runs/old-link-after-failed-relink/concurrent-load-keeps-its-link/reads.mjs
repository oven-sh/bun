import { member as inner } from "./user.mjs";
export const member = () => "reads " + inner();
