// Whether a field of a class is assigned or defined is an option of tsconfig.json, "useDefineForClassFields". Each file here prints which of the two happened to the fields of its class: an assigned
// field runs the setter of the class above, and a field without a value makes no key; a defined field becomes an own key either way.
// An executable goes by the tsconfig.json nearest to the file that holds the class. `bun run` goes by the one that holds for the folder it is started in, for every file.
import "./assigned/names.ts";
import "./assigned/a-key-that-is-a-constant.ts";
import "pack";
import "./defined/names.ts";
import "./defined/assigned/names.ts";

class Above {}
Object.defineProperty(Above.prototype, "y", {
  set(value: unknown) {
    console.log("the entry point: the setter of the class above ran with", value);
  },
  configurable: true,
});
class Below extends Above {
  y = 2;
  optional?: number;
}
console.log("the entry point: own keys:", Object.keys(new Below()).join(" ") || "none");
/* Output:
a folder that says assigned: the setter of the class above ran with 2
a folder that says assigned: own keys: none
a folder that says assigned, beside a key that is a constant: the setter of the class above ran with 2
a folder that says assigned, beside a key that is a constant: own keys: name
a package that says assigned: the setter of the class above ran with 2
a package that says assigned: own keys: none
a folder that says defined: own keys: y optional
a folder that says assigned in one that says defined: the setter of the class above ran with 2
a folder that says assigned in one that says defined: own keys: none
the entry point: own keys: y optional
*/
