import { expect } from "bun:test";
const decoded = text => Buffer.from(text).toString();
const sql = (0, eval)(decoded("Bun.sql"));
console.log(typeof sql);
let message = "";
try {
  expect({ sql }).toEqual({ other: 1 });
} catch (error) {
  message = String(error.message);
}
console.log(message.includes("[Function: sql]") ? "printed as a function" : message.slice(0, 300));
