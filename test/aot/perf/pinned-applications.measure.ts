import { test } from "../harness/declare";
import { unsupported } from "../harness/compiler";
import { pinnedApplications } from "./pinned-applications";

if (unsupported) test.skip(unsupported, () => {});
else await pinnedApplications();
