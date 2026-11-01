import { test } from "../harness/declare";
import { unsupported } from "../harness/compiler";
import { generatedCodeOfIdioms } from "./generated-code";

if (unsupported) test.skip(unsupported, () => {});
else await generatedCodeOfIdioms(8, 26);
