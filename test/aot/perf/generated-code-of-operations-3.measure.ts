import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { generatedCodeOfOperations } from "./generated-code";

if (unsupported) test.skip(unsupported, () => {});
else await generatedCodeOfOperations(3, 4);
