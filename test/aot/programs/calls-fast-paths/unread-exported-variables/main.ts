// A module is imported by import(), and only some members of its namespace object are ever read. A variable that is exported and that nothing reads is not stored to, and what was made for it alone is not made; what its initializer does besides is done.
// IR- ^ .*only in the unread arrow
// IR- ^ .*only in the unread list
// IR+ ^ .*read by name
// IR+ ^ .*read by the module itself
// IR+ ^ .*read by an import
// IR+ ^ .*the call is carried out
import { readByAnImport, storesLater, count, whatWasMade } from "./values.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
async function all(): Promise<void> {
    const ns = await import("./values.ts");
    say("read by name", ns.readByName());
    say("read by the module itself", ns.readsItsOwn());
    say("read by an import", readByAnImport());
    storesLater();
    count();
    count();
    say("a live binding", ns.counted);
    say("what was made", whatWasMade());
}
all().then(() => console.log(lines.join("\n")));
