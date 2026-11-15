console.log("base runs");
export class Base {
  name() {
    return "real";
  }
}
export const later = import("./rung.mjs").then(found => found.one, error => error.name);
