// Only native code enters the accessor that a signature inherits, toString() of a type, of what is answered for `returns` and of the name of a library.
const { dlopen, viewSource } = Bun.FFI;
class Signature {
  get returns() {
    console.log("returns asked");
    return {
      toString() {
        console.log("text asked");
        return "void";
      },
    };
  }
}
const kind = new String("i32");
kind.toString = () => {
  console.log("kind asked");
  return "i32";
};
const made = new Signature();
made.args = [kind];
console.log(typeof viewSource({ made }, false)[0]);
console.log(
  dlopen(
    {
      toString() {
        console.log("name asked");
        return "made-up-library";
      },
    },
    { made },
  ).code,
);
