import { value as a } from "./ring-a.ts";
import { more } from "./second.ts";
(globalThis as any).log.push("third runs " + a + " " + more());
export const value = a + more();
