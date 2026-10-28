// Only an interface is imported from the file. A field of it has the type of an enum of that file, whose members are made of other members.
import { Options } from "./options";
function describe(options: Options): string {
  return options.name + " " + options.flags + " " + (options.flags & 2);
}
console.log(describe({ name: "first", flags: 3 }), describe({ name: "second", flags: 1 }));
