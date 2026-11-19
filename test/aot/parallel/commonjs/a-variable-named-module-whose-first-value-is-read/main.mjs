// Each of these files reads `module` or `require` where it may still hold what the wrapper handed in.
import * as inFront from "./in-front.cjs";
import * as hoisted from "./hoisted.cjs";
import * as ownInitializer from "./own-initializer.cjs";
import * as outsideTheBlock from "./outside-the-block.cjs";
import * as otherCase from "./other-case.cjs";
import * as behindATry from "./behind-a-try.cjs";
import * as calledByTheInitializer from "./called-by-the-initializer.cjs";
import * as sameStatement from "./same-statement.cjs";
for (const [name, file] of Object.entries({ inFront, hoisted, ownInitializer, outsideTheBlock, otherCase, behindATry, calledByTheInitializer, sameStatement }))
  console.log(name, JSON.stringify(file.default));
