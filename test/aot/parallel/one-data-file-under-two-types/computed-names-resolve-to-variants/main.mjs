import asText from "./data.json" with { type: "text" };
import note from "./note.txt" with { type: "text" };
import { read, resolve } from "./reader.cjs";
console.log(typeof asText, typeof note);
for (const name of ["./data.json", "./note.txt", "./absent.json"]) {
  try {
    console.log(name, resolve(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
console.log(read("./note.txt"), read("./note.txt"));
console.log(typeof (await import(["./data", "json"].join("."), { with: { type: "text" } })).default);
