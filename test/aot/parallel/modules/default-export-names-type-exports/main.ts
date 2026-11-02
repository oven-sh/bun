// `export default Name`, where the file declares `Name` only as a type, runs nothing and gives the file no export named `default`.
import * as ahead from "./ahead";
import * as alias from "./alias";
import * as asserted from "./asserted";
import * as besideDeclaredConstant from "./beside-a-declared-constant";
import * as commonJsExtension from "./commonjs-extension.cts";
import * as declaredGlobalValue from "./declared-global-value";
import * as declaredNamespace from "./declared-namespace";
import * as exportedInterface from "./exported-interface";
import * as genericAlias from "./generic-alias";
import * as hollowNamespace from "./hollow-namespace";
import * as inDeclareGlobal from "./in-declare-global";
import * as shape from "./interface";
import Shape, { value } from "./interface";
import * as mergedWithConstant from "./merged-with-a-constant";
import * as moduleExtension from "./module-extension.mts";
import * as namedAsGlobal from "./named-as-a-global";
import * as star from "./star";

interface Only {
  a: number;
}
export default Only;

function describe(name: string, namespace: object) {
  const key = ["def", "ault"].join("");
  const found = (namespace as Record<string, unknown>)[key];
  console.log(
    name,
    Object.keys(namespace),
    "default" in namespace,
    key in namespace,
    typeof found,
    Object.getOwnPropertyDescriptor(namespace, key)?.enumerable,
  );
}

const held: Shape[] = [];
console.log("main", held.length, value);
describe("ahead", ahead);
describe("alias", alias);
describe("asserted", asserted);
describe("beside a declared constant", besideDeclaredConstant);
describe("commonjs extension", commonJsExtension);
describe("declared global value", declaredGlobalValue);
describe("declared namespace", declaredNamespace);
describe("exported interface", exportedInterface);
describe("generic alias", genericAlias);
describe("hollow namespace", hollowNamespace);
describe("in declare global", inDeclareGlobal);
describe("interface", shape);
describe("merged with a constant", mergedWithConstant);
describe("module extension", moduleExtension);
describe("named as a global", namedAsGlobal);
describe("star", star);
describe("required", require("./interface"));
describe("required alone", require("./required-alone"));
describe("imported on demand", await import("./interface"));
describe("imported on demand alone", await import("./imported-on-demand-alone"));
console.log((shape as { default?: unknown }).default, (mergedWithConstant as { default?: unknown }).default);
