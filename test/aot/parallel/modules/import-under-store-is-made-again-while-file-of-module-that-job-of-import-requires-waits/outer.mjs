import { name as early } from "./early.cjs";
see("outer begins over " + early);
const root = store.run("R", () => require("./root.mjs"));
see("outer goes on with " + root.name);
export {};
