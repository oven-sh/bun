import { say } from "./helpers/say";
export const exported = "exported by a test file";
say("c", "its own test", () => exported.length);
