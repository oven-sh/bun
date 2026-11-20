import { readFileSync } from "node:fs";
import { join } from "node:path";
const one = { valueOf() { throw new Error("no number"); }, toString() { throw new Error("no text"); } };
let spare = 0;
function sum() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    one + 1;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function template() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    `${one}`;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function sign() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    -one;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function comparison() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    one < 2;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function raised() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    spare += one;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
try {
  console.log(sum());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(template());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(sign());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(comparison());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(raised());
} catch (error) {
  console.log(error.code);
}
