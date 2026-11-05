import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { pinnedIdiomsInParts } from "./pinned-idioms";

if (unsupported) test.skip(unsupported, () => {});
else await pinnedIdiomsInParts(1, 4);
