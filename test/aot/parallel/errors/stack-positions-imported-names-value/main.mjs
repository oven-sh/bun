// Each line: where the frames stand behind a name that an import binds and whose value nobody takes: on the left of a comma, or as a statement.
import { counter, step, show } from "./helpers.mjs";
import * as all from "./helpers.mjs";
try {
  await import("./value.mjs");
} catch (error) {
  show("default", error);
}
function inFunction() {
  return (counter, `${{ toString: () => String(step(2)) }}`);
}
function statement() {
  counter;
  return `${{ toString: () => String(step(2)) }}`;
}
function local() {
  const here = 1;
  return (here, `${{ toString: () => String(step(2)) }}`);
}
function namespace() {
  return (all, `${{ toString: () => String(step(2)) }}`);
}
function member() {
  return (all.counter, `${{ toString: () => String(step(2)) }}`);
}
function importedFunction() {
  return (step, `${{ toString: () => String(step(2)) }}`);
}
for (const f of [inFunction, statement, local, namespace, member, importedFunction]) {
  try {
    f();
    console.log(f.name, "no error");
  } catch (error) {
    show(f.name, error);
  }
}
import fallback from "./fallback.mjs";
function defaultImport() {
  return (fallback, `${{ toString: () => String(step(2)) }}`);
}
function twoNames() {
  return (counter, step, `${{ toString: () => String(step(2)) }}`);
}
function behindLocal() {
  const here = 1;
  return (counter, here, `${{ toString: () => String(step(2)) }}`);
}
function inCondition() {
  if (counter) return 1;
  return `${{ toString: () => String(step(2)) }}`;
}
function negated() {
  !counter;
  return `${{ toString: () => String(step(2)) }}`;
}
for (const f of [defaultImport, twoNames, behindLocal, inCondition, negated]) {
  try {
    f();
    console.log(f.name, "no error");
  } catch (error) {
    show(f.name, error);
  }
}
