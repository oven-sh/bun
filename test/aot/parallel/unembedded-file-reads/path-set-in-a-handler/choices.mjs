import { readFileSync } from "node:fs";
import { join } from "node:path";
const nothing = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST?.split("");
let turn = 1;
let spare = 0;
function choice() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    turn ? nothing.member : 0;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function logic() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    turn && nothing.member;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function filled() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    spare ||= nothing.member;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function early() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    late;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
try {
  console.log(choice());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(logic());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(filled());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(early());
} catch (error) {
  console.log(error.code);
}
const late = 1;
