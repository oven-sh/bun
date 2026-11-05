// @ts-nocheck
import * as ns from "object-literal";
const key = "default";
const { default: taken } = ns as any;
console.log("cast", typeof (ns as any).default, (ns as any).default === ns);
console.log("two casts", typeof (ns as unknown as { default: unknown }).default, typeof (ns as any)!.default, typeof (ns satisfies unknown as any).default);
console.log("literal key", typeof (ns as any)["default"], typeof ns["default"]);
console.log("computed key", typeof (ns as any)[key]);
console.log("destructured", typeof taken);
console.log("optional", typeof (ns as any)?.default, typeof ns?.default);
console.log("member", typeof (ns as any).default?.zeta, typeof ns.default?.zeta);
