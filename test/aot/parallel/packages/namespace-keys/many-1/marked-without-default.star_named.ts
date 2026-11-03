// @ts-nocheck
import * as ns from "marked-without-default";
import { zeta } from "marked-without-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
