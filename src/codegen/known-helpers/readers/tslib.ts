import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { functionsOfUnit, readUnit, type FoundFunction } from "../definitions.ts";
import { isFunction, type Node } from "../syntax.ts";

function factoryBodies(program: Node): Node[][] {
  const bodies: Node[][] = [];
  for (const statement of program.body) {
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "CallExpression") continue;
    for (const argument of statement.expression.arguments) if (isFunction(argument)) bodies.push(argument.body.body);
  }
  return bodies;
}

export function readTslib(folder: string): FoundFunction[] {
  const found: FoundFunction[] = [];
  for (const file of ["tslib.js", "tslib.es6.js", "tslib.es6.mjs"]) {
    const full = path.join(folder, file);
    if (!existsSync(full)) continue;
    const unit = readUnit(file, readFileSync(full, "utf8"), program => [program.body, ...factoryBodies(program)]);
    if (unit === undefined) throw new Error(`${full} does not parse`);
    found.push(...functionsOfUnit(unit, () => true));
  }
  return found;
}
