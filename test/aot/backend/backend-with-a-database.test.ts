import { unsupported } from "../harness/compiler";
import { test } from "../listed";
import { testOptIn } from "../opt-in";

if (unsupported) test.skip(unsupported, () => {});
else await testOptIn("AOT_BACKEND", "1", "backend/backend");
