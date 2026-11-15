// An element of the list that is no Uint8Array is refused, and the error describes it: it reads the name off its constructor, which is a getter of the program here.
let asked = 0;
class Odd {
  static get name() {
    asked++;
    return "Odd";
  }
}
try {
  Buffer.concat([new Odd()]);
} catch (error) {
  console.log(error.code);
}
console.log(asked > 0);
