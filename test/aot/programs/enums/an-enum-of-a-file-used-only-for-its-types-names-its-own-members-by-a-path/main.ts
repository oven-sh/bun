// The file of the enum is imported for a type alone, so the executable holds no code of it. A member of the enum is made of other members, named by a path that begins at the enum.
import { Flags } from "./flags";
function describe(flags: Flags): string {
  return "flags " + flags;
}
console.log(describe(3), describe(1), describe(0));
