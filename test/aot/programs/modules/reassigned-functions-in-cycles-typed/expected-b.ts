import { h, setH } from "./expected-a";
export const seen: string = h(1);
setH(n => "other" + n);
