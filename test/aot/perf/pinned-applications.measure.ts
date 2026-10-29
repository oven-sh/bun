import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { pinnedApplications } from "./pinned-applications";

if (unsupported) test.skip(unsupported, () => {});
else await pinnedApplications();
