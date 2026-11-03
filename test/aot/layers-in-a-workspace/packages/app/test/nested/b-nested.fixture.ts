import { say, helperState } from "../helpers/say";
import { load, counts } from "@app/main";
import { exported } from "../c-imports-a-test-file.test";
say("b", "a helper loaded once", () => helperState.loaded);
say("b", "a path that the test computes, loaded by the application", () => load(import.meta.dir + "/../helpers/" + ["la", "te"].join("") + ".ts"));
say("b", "a test file imports a test file", () => exported);
say("b", "fresh state in this file", () => counts());
