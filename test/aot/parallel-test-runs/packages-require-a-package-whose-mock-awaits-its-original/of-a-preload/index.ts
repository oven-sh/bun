import { again, viaMid } from "mid";
import { version } from "lib";
console.log("SAID the importer begins with", version);
export const both = () => [viaMid(1), again(), version].join(", ");
