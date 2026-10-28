import { generated, type Generated } from "./generated/run-generated";
import {
  declaredTypes,
  guards,
  programOfDeclaredParameter,
  programOfProxiesHandedOver,
  programOfProxyMadeInPlace,
  targets,
} from "./generated/what-a-proxy-answers-behind-a-guard";

const programs: Generated[] = [];
for (const guard of Object.keys(guards))
  programs.push({
    name: `handed over, behind ${guard}`,
    isAlwaysRun: true,
    wasOnceWrong: guard === "typeof-function" || guard === "typeof-not-object",
    isOnlyCompiled: true,
    make: () => programOfProxiesHandedOver(guard),
  });
for (const type of Object.keys(declaredTypes))
  programs.push({
    name: `handed to a parameter declared ${type}`,
    isAlwaysRun: true,
    isOnlyCompiled: true,
    make: () => programOfDeclaredParameter(type),
  });
for (const target of Object.keys(targets))
  programs.push({
    name: `a proxy of ${target} made in place`,
    isAlwaysRun: true,
    isOnlyCompiled: true,
    make: () => programOfProxyMadeInPlace(target),
  });

generated("what a proxy answers behind a guard", programs);
