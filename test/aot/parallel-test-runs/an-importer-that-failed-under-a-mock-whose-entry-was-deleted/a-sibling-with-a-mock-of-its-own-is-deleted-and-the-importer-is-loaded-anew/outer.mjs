import { seen as inner } from "./user.mjs";
export const seen = () => "outer " + inner();
