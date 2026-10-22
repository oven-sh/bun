// The package says nothing about side effects, so an import of one name from index.js evaluates all five files behind it, in the order of the exports.
import { third } from "five-files";

console.log(third);
