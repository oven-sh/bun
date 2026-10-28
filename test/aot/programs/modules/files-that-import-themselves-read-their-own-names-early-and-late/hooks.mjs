import * as self from "./hooks.mjs";
import { late as lateOfSelf } from "./hooks.mjs";
export * as default from "./hooks.mjs";
const attempt = (name, read) => {
  try {
    console.log(name, read());
  } catch (error) {
    console.log(name, error.name);
  }
};
export const other = "other";
attempt("hooks: late through the namespace, early", () => self.late);
attempt("hooks: late by name, early", () => lateOfSelf);
attempt("hooks: late through default, early", () => self.default.late);
export function readLate() {
  return lateOfSelf + self.late;
}
attempt("hooks: a function, early", readLate);
export const late = "late";
attempt("hooks: late through the namespace", () => self.late);
attempt("hooks: a function", readLate);
