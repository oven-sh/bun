import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { pinnedEverydayIdioms } from "./pinned-everyday-idioms";

if (unsupported) test.skip(unsupported, () => {});
else await pinnedEverydayIdioms(4, 8);
