say("b starts");
Promise.resolve().then(() => say("a job of b, ahead of the call"));
import("./mid.mjs").then(it => say("the import is in: " + it.value), error => say("the import failed: " + error.message));
Promise.resolve().then(() => say("a job of b, behind the call")).then(() => say("its second")).then(() => say("its third")).then(() => say("its fourth")).then(() => say("its fifth"));
say("b ends");
