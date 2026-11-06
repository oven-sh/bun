import { seen as inner } from "./imports-sides.mjs";
console.log("THE BODY OF imports-the-importer RUNS");
export const seen = () => inner();
