import { early } from "./importer.mjs";
try {
  console.log("first", early());
} catch (error) {
  console.log("first", error.constructor.name);
}
