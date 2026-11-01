import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { testOptIn } from "../opt-in";

if (unsupported) test.skip(unsupported, () => {});
else await testOptIn("AOT_BACKEND", "1", "backend/backend");
