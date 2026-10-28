import { early } from "./reader.mjs";
for (const key of ["config", "version"]) {
  try {
    console.log("caller:", early(key));
  } catch (error) {
    console.log("caller:", error.constructor.name);
  }
}
