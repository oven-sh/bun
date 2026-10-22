import * as cycle from "./late.js";
const lateKey = ["la", "te"].join("");
const attempt = ask => { try { return String(ask()); } catch (error) { return error.name; } };
export const ways = [
  ["in", () => "late" in cycle],
  ["Object.hasOwn", () => Object.hasOwn(cycle, "late")],
  ["hasOwnProperty", () => cycle.hasOwnProperty("late")],
  ["hasOwnProperty.call", () => Object.prototype.hasOwnProperty.call(cycle, "late")],
  ["propertyIsEnumerable", () => cycle.propertyIsEnumerable("late")],
  ["Reflect.has", () => Reflect.has(cycle, "late")],
  ["Object.keys", () => Object.keys(cycle).includes("late")],
  ["Object.getOwnPropertyNames", () => Object.getOwnPropertyNames(cycle).includes("late")],
  ["Reflect.ownKeys", () => Reflect.ownKeys(cycle).includes("late")],
  ["Object.getOwnPropertyDescriptor", () => Object.getOwnPropertyDescriptor(cycle, "late") !== undefined],
  ["Reflect.getOwnPropertyDescriptor", () => Reflect.getOwnPropertyDescriptor(cycle, "late") !== undefined],
  ["Object.getOwnPropertyDescriptors", () => "late" in Object.getOwnPropertyDescriptors(cycle)],
  ["Object.entries", () => Object.entries(cycle).some(([key]) => key === "late")],
  ["Object.values", () => Object.values(cycle).includes(1)],
  ["spread", () => "late" in { ...cycle }],
  ["JSON.stringify of a spread", () => JSON.stringify({ ...cycle }).includes("late")],
  ["Object.assign", () => "late" in Object.assign({}, cycle)],
  ["rest", () => (({ other, ...rest }) => "late" in rest)(cycle)],
  ["for-in", () => (() => { for (const key in cycle) if (key === "late") return true; return false; })()],
  ["read", () => cycle.late],
  ["read by a computed key", () => cycle[lateKey]],
  ["Reflect.get", () => Reflect.get(cycle, "late")],
  ["destructuring", () => (({ late }) => late)(cycle)],
  ["destructuring with a default", () => (({ late = "default" }) => late)(cycle)],
  ["typeof", () => typeof cycle.late],
  ["??", () => cycle.late ?? "absent"],
  ["delete", () => delete cycle.late],
];
export const before = ways.map(([, ask]) => attempt(ask));
export const askAgain = () => ways.map(([, ask]) => attempt(ask));
export const direct = [];
try { direct.push(String("late" in cycle)); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.hasOwn(cycle, "late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(cycle.hasOwnProperty("late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.prototype.hasOwnProperty.call(cycle, "late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(cycle.propertyIsEnumerable("late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Reflect.has(cycle, "late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.keys(cycle).includes("late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.getOwnPropertyNames(cycle).includes("late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Reflect.ownKeys(cycle).includes("late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.getOwnPropertyDescriptor(cycle, "late") !== undefined)); } catch (error) { direct.push(error.name); }
try { direct.push(String(Reflect.getOwnPropertyDescriptor(cycle, "late") !== undefined)); } catch (error) { direct.push(error.name); }
try { direct.push(String("late" in Object.getOwnPropertyDescriptors(cycle))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.entries(cycle).some(([key]) => key === "late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String(Object.values(cycle).includes(1))); } catch (error) { direct.push(error.name); }
try { direct.push(String("late" in { ...cycle })); } catch (error) { direct.push(error.name); }
try { direct.push(String(JSON.stringify({ ...cycle }).includes("late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String("late" in Object.assign({}, cycle))); } catch (error) { direct.push(error.name); }
try { direct.push(String((({ other, ...rest }) => "late" in rest)(cycle))); } catch (error) { direct.push(error.name); }
try { direct.push(String((() => { for (const key in cycle) if (key === "late") return true; return false; })())); } catch (error) { direct.push(error.name); }
try { direct.push(String(cycle.late)); } catch (error) { direct.push(error.name); }
try { direct.push(String(cycle[lateKey])); } catch (error) { direct.push(error.name); }
try { direct.push(String(Reflect.get(cycle, "late"))); } catch (error) { direct.push(error.name); }
try { direct.push(String((({ late }) => late)(cycle))); } catch (error) { direct.push(error.name); }
try { direct.push(String((({ late = "default" }) => late)(cycle))); } catch (error) { direct.push(error.name); }
try { direct.push(String(typeof cycle.late)); } catch (error) { direct.push(error.name); }
try { direct.push(String(cycle.late ?? "absent")); } catch (error) { direct.push(error.name); }
try { direct.push(String(delete cycle.late)); } catch (error) { direct.push(error.name); }
