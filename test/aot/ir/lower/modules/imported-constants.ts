// RUN(BRANCH): lower
// BRANCH-LABEL: function {{*}}name="choose"
// BRANCH-NOT: ImportCall
// BRANCH: Return

// RUN(LIVE): lower
// LIVE-LABEL: function {{*}}name="readLive"
// LIVE-COUNT-2: = GetModuleVariable
// LIVE-NOT: = GetModuleVariable
// LIVE: Return

import { debug, open } from "./imports/constants/flags";
import { debug as exportedAgain, twice } from "./imports/constants/barrel";
import * as flags from "./imports/constants/flags";

export function choose() {
  if (debug || exportedAgain || twice !== 6) return import("./imports/values");
  return flags.level > 3 ? import("./imports/values") : "quiet";
}

export function readLive() {
  return [open, flags.open];
}
