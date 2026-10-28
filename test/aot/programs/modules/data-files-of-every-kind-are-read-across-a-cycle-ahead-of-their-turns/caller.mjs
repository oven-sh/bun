import { readers } from "./reader.mjs";
for (const [name, read] of Object.entries(readers())) {
  try {
    console.log("caller:", name, read());
  } catch (error) {
    console.log("caller:", name, error.constructor.name);
  }
}
