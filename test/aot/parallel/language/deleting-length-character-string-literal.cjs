// `delete` of the length or of a character of a string that is written as a literal. Neither can be deleted: the answer is false in sloppy code, and strict code, here the body of a class, throws: see docs/compiler/compatibility.mdx.
function tell(label, ask) {
  try {
    console.log(label, ask());
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}
tell("sloppy length", () => delete "text".length);
tell("sloppy character", () => delete "text"[1]);
tell("sloppy past the end", () => delete "text"[9]);
tell("sloppy another name", () => delete "text".other);
class Strict {
  static length = () => delete "text".length;
  static character = () => delete "text"[1];
  static pastTheEnd = () => delete "text"[9];
  static anotherName = () => delete "text".other;
}
tell("strict length", Strict.length);
tell("strict character", Strict.character);
tell("strict past the end", Strict.pastTheEnd);
tell("strict another name", Strict.anotherName);
/* Output:
sloppy length false
sloppy character false
sloppy past the end true
sloppy another name true
strict length TypeError
strict character TypeError
strict past the end true
strict another name true
*/
