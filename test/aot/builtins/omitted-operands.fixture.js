import { readFileSync } from "node:fs";

const notCalled = new Set(
  readFileSync(process.argv[2], "utf8")
    .split("\n")
    .filter(line => line.includes("it is not called"))
    .map(line => line.split(":")[0]),
);
const { entries } = JSON.parse(readFileSync(process.argv[3], "utf8"));

function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value).slice(0, 80);
  return Object.prototype.toString.call(value) + (ArrayBuffer.isView(value) ? value.length : "");
}

function describe(error) {
  const message = String(error?.message).replace(/ \(evaluating .*/, "");
  return `${error?.name} | ${error?.code} | ${message.slice(0, 100)}`;
}

function find(path) {
  if (path.includes("%") || path.includes(".prototype") || path.includes("@@")) return undefined;
  const module = /^((?:node|bun):[\w/]+)\.?(.*)$/.exec(path);
  try {
    let at = module ? require(module[1]) : globalThis;
    const rest = module ? module[2] : path;
    for (const name of rest ? rest.split(".") : []) at = at?.[name];
    return typeof at === "function" ? at : undefined;
  } catch {
    return undefined;
  }
}

async function settle(make) {
  try {
    const value = make();
    if (!(value instanceof Promise)) return "= " + show(value);
    const late = Symbol();
    const settled = value.then(
      result => "resolved " + show(result),
      error => "rejected " + describe(error),
    );
    const first = await Promise.race([settled, new Promise(resolve => setTimeout(resolve, 300, late))]);
    return first === late ? "pending" : first;
  } catch (error) {
    return "! " + describe(error);
  }
}

const firstOf = overload => overload.parameters.find(parameter => parameter.operand.argument === 0);
const withoutNumbers = text => text.replace(/\d{6,}|0x[0-9a-f]+/g, "#");
let asked = 0;
for (const entry of entries) {
  for (const mode of ["Call", "Construct"]) {
    const overloads = entry.overloads.filter(it => it.mode === mode && !it.isUndeclared && !it.receiver);
    const takesNone = overloads.some(it => {
      const first = firstOf(it);
      return !first || first.mode !== "Required" || first.accepted.primitives.includes("NotPassed");
    });
    const filled = overloads.find(it => {
      const { accepted } = firstOf(it) ?? {};
      return accepted?.isAnything || accepted?.primitives.includes("Undefined");
    });
    if (takesNone || !filled || overloads.some(it => notCalled.has(it.token))) continue;
    const callee = find(entry.path);
    if (!callee) continue;
    asked++;
    const isNew = mode === "Construct";
    const omitted = await settle(() => (isNew ? new callee() : callee()));
    const passed = await settle(() => (isNew ? new callee(undefined) : callee(undefined)));
    if (withoutNumbers(omitted) !== withoutNumbers(passed))
      console.log(`DIFFERS ${filled.token}: ${omitted} <> ${passed}`);
  }
}
console.log("ASKED", asked > 50);
process.exit(0);
