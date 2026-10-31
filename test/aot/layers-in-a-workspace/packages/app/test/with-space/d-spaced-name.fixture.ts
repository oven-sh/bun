import { say } from "../helpers/say";
import { names } from "../../src/main";
say("d", "a path with a space and an umlaut", () => [import.meta.file, names().length, import.meta.dir.split("/").pop()]);
