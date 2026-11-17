import { OWN } from "./main";
export function fromCycle() {
  return new Function(OWN)();
}
export function useCycle() {
  try {
    return new Function("a", "return a + " + OWN.length)(1);
  } catch (error) {
    return (error as Error).name;
  }
}
