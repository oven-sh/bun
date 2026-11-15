import { readFileSync } from "node:fs";
import { join } from "node:path";
const nothing = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST?.split("");
function pattern() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    const { member } = nothing;
    void member;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function list() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    const [first] = nothing;
    void first;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function turns() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    for (const it of nothing) break;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function heir() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    globalThis.heir = class extends nothing {};
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
try {
  console.log(pattern());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(list());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(turns());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(heir());
} catch (error) {
  console.log(error.code);
}
