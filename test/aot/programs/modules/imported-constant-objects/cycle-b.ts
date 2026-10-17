import { readCyclicLiteral, readCyclicMade } from "./cycle-a";
function attempt(f: () => unknown) {
  try {
    return String(f());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
export const early = [attempt(readCyclicLiteral), attempt(readCyclicMade)].join();
