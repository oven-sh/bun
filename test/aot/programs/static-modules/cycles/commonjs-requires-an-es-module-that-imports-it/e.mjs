import k, { early } from "./k.cjs";
export const seen = [early, k.early, k.late, Object.keys(k).join()].join("|");
export const readLater = () => [early, k.late].join("|");
