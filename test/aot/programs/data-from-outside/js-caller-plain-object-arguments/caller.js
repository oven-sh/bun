import { one, many, keyed, held, Service, arrow, own } from "./typed.ts";
const row = (name, run) => { try { console.log(name + ": " + run()); } catch (error) { console.log(name + ": THROWS " + String(error).split(" (bun")[0]); } };
const plain = () => ({ id: 1, name: "given" });
export function run() {
  row("one", () => one(plain()));
  row("many", () => many([plain(), plain()]));
  row("keyed", () => keyed(new Map([["k", plain()]])));
  row("held", () => held({ inner: plain() }));
  row("a method", () => new Service().take(plain()));
  row("a method with an array", () => new Service().all([plain()]));
  row("an arrow function", () => arrow(plain()));
  row("by value", () => [plain()].map(one).join());
  row("own", () => own());
}
