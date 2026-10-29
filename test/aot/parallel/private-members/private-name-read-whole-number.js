// Methods read a private name off whole numbers that are written in parentheses. One of them never runs. Plain Bun prints another output.
class Holder {
  #a = 1;
  neverRuns() {
    return (1e307).#a;
  }
  small() {
    return (5).#a;
  }
  hexadecimal() {
    return (0x10).#a;
  }
  long() {
    return (1000000000000000000000).#a;
  }
  asked() {
    return #a in Object(5);
  }
  own() {
    return this.#a;
  }
}
const holder = new Holder();
for (const name of ["small", "hexadecimal", "long", "asked", "own"]) {
  try {
    console.log(name, holder[name]());
  } catch (error) {
    console.log(name, error.name);
  }
}
console.log(typeof holder.neverRuns);
/* Output:
small TypeError
hexadecimal TypeError
long TypeError
asked false
own 1
function
*/
