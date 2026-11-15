import * as all from "./t.mjs";
export const late = () => Object.keys(all).filter(name => name !== "default").join() + " y " + all.y + " who " + all.who;
