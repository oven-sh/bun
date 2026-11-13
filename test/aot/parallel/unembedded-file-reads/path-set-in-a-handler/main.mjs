// What throws in a `try` without a call in sight leads to its handler, so the path that the handler sets is read behind it.
// Reference: bun build --compile
// Build prints: 18 x warn: TS100098: This reads "kept.txt", but the executable has no file at that path. Embed it with --asset kept.txt
// Build prints: 19 x warn: TS100098: This reads "set.txt", but the executable has no file at that path. Embed it with --asset set.txt
import "./operators.mjs";
import "./members.mjs";
import "./choices.mjs";
import "./patterns.mjs";
import "./between.mjs";
