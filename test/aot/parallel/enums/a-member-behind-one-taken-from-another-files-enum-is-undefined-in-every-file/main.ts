// `bun run` looks at one file at a time: a member whose value comes from another file's enum is worked out at run time, and the member behind it, which has no value of its own, is undefined.
// TypeScript says 3. What matters here is that every file of the program sees one value.
import * as space from "./codes";
import { BehindConstant, failure, here, Inlined, Level, Third } from "./codes";
const made = failure("disk");
console.log((made.level === Level.Error ? "error: " : "warning: ") + made.text);
console.log(String(here()));
console.log(
  String([
    Level.Warn,
    Level.Error,
    Level.Fatal,
    Level.Written,
    Level.Next,
    Inlined.Error,
    BehindConstant.More,
    Third.Second,
  ]),
);
console.log(Level["Error"], space.Level.Error, typeof Level.Error, new Set([made.level]).has(Level.Error));
switch (made.level) {
  case Level.Error:
    console.log("the clause is taken");
    break;
  default:
    console.log("no clause is taken");
}
