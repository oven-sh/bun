// A `const enum` that is read through a namespace of another file, through an `import =` alias or from another part of its namespace. An executable puts the value in place of every read, as TypeScript's compiler does when it compiles the files together. `bun run` reads the object in these places, so it sees what the program stores there.
import * as all from "./other";
import { Outer, store } from "./other";
import Alias = Outer.Fixed;

namespace Parts {
  export const enum One {
    A = 40,
  }
}
namespace Parts {
  export function read() {
    return [One.A, One["A"], Parts.One.A];
  }
}
namespace Here {
  export const enum Fixed {
    A = 50,
  }
  export const other = 1;
}
import Linked = Here.Fixed;

function show(label: string) {
  console.log(
    label,
    "a namespace of another file",
    Outer.Fixed.A,
    Outer["Fixed"].A,
    Outer["Fixed"]["A"],
    Outer.Fixed["A"],
    Outer.Fixed.Text,
  );
  console.log(label, "through the module", all.Outer.Fixed.A, all["Outer"]["Fixed"].A, all.Outer.Fixed.Text);
  console.log(label, "an alias of that one", Alias.A, Alias["A"], Alias.Text);
  console.log(label, "another part of its namespace", ...Parts.read());
  console.log(label, "an alias in this file", Linked.A, Linked["A"], Here.Fixed.A);
}

show("read:");
store(Outer);
store(Parts);
store(Here);
show("stored:");
/* Output:
read: a namespace of another file 10 10 10 10 text
read: through the module 10 10 text
read: an alias of that one 10 10 text
read: another part of its namespace 40 40 40
read: an alias in this file 50 50 50
stored: a namespace of another file 10 10 10 10 text
stored: through the module 10 10 text
stored: an alias of that one 10 10 text
stored: another part of its namespace 40 40 40
stored: an alias in this file 50 50 50
*/
