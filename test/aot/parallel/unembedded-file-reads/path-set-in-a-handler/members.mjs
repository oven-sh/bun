import { readFileSync } from "node:fs";
import { join } from "node:path";
const one = { valueOf() { throw new Error("no number"); }, toString() { throw new Error("no text"); } };
const nothing = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST?.split("");
const given = new Proxy({}, { get() { throw new Error("no member"); } });
function asksNothing() {
  return nothing.member;
}
function member() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    nothing.member;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function chain() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    given?.member;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function search() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    "a" in nothing;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function kind() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    one instanceof nothing;
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
function nested() {
  let path = join(import.meta.dirname, "kept.txt");
  try {
    asksNothing();
  } catch {
    path = join(import.meta.dirname, "set.txt");
  }
  return readFileSync(path, "utf8");
}
try {
  console.log(member());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(chain());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(search());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(kind());
} catch (error) {
  console.log(error.code);
}
try {
  console.log(nested());
} catch (error) {
  console.log(error.code);
}
