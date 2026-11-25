import { dep } from "./star";
import "./third";
console.log("importer");
export const importer = () => dep();
