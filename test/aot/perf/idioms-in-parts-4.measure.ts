import { test } from "../harness/declare";
import { unsupported } from "../harness/compiler";
import { pinnedIdiomsInParts } from "./pinned-idioms";

if (unsupported) test.skip(unsupported, () => {});
else await pinnedIdiomsInParts(4, 4);
