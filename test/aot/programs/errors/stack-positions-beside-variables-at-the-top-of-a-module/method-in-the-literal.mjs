import { fail } from "./fail.mjs";
const atTop = `${{
  toString() {
    return String(fail());
  },
}}`.length;
