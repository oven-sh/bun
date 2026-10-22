// A module is imported by import(), and only some members of its namespace object are ever read. A class that is exported and that nothing names, neither its constructor nor a member of it, has no code in the program; what its declaration does besides is done.
// IR- ^ .*only in the unread class
// IR+ ^ .*in the class that is read
// IR+ ^ .*in the class that a function makes
// IR+ ^ .*in the parent of a class that is read
// IR+ ^ .*in the child
// IR+ ^ .*in the static method that is called
// IR+ ^ .*the static field is initialized
import { OnlyItsStaticMethodIsCalled, whatWasMade } from "./classes.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
async function all(): Promise<void> {
    const { Read, makes, Child } = await import("./classes.ts");
    say("read", new Read().method(), new Read().value);
    say("made by a function", makes().method());
    const child = new Child();
    say("a child", child.other(), child.method());
    say("a static method", OnlyItsStaticMethodIsCalled.answer());
    say("what was made", whatWasMade());
}
all().then(() => console.log(lines.join("\n")));
