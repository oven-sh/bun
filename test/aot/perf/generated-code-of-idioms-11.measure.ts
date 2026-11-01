import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { generatedCodeOfIdioms } from "./generated-code";

if (unsupported) test.skip(unsupported, () => {});
else await generatedCodeOfIdioms(11, 26);
