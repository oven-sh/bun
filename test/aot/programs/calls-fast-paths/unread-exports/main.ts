// A module is imported by import(), and all that is ever done with its namespace object is to read members by constant names. An export that nobody calls, names or reads is not in the program: so the variable its setter would store to holds what it was declared with.
// IR+ ^variable g\d+ name="hook" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="moreHook" .*declared=f\d+( |$)
import { callHook, count } from "./hooks.ts";
import { callMoreHook } from "./more.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
async function all(): Promise<void> {
    say("before", callHook());
    const { unrelated, constant } = await import("./hooks.ts");
    say("taken by a pattern", unrelated(), constant);
    say("called as a method", (await import("./hooks.ts")).calledAsAMethod(1));
    const ns = await import("./hooks.ts");
    count();
    say("read by name", ns.counter, ns.constant, typeof ns.unrelated, ns === (await import("./hooks.ts")));
    say("a name that is not there", (ns as any).nothing);
    const [first, { other, word }] = await Promise.all([import("./hooks.ts"), import("./more.ts")]);
    say("taken apart behind Promise.all", first.constant, first.unrelated(), other(), word);
    const results = await Promise.all([import("./more.ts"), import("./hooks.ts"), import("./more.ts")]);
    say("read by constant indexes", results.length, results[0].word, results[1].constant, results[2].other(), results[0] === results[2]);
    say("after", callHook());
    say("after, more", callMoreHook());
}
all().then(() => console.log(lines.join("\n")));
