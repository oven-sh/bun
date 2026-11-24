import { version } from "lib";
import { again, viaMid } from "mid";
console.log("SAID the importer begins with", version);
export const both = () => [viaMid(1), again(), version].join(", ");
