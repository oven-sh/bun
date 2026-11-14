// One key in two spellings: TypeScript 7 takes them for two properties, the program has one.
const high = "\ud83d", low = "\ude00";
const joined = `${high}${low}`;
const faces = { [joined]: 1, "\u{1F600}": "two" };
console.log(Object.keys(faces).length, faces["\u{1F600}"], typeof faces[joined], String(faces[joined]));
class Faces {
    [joined] = 1;
    "\u{1F600}" = "two";
}
const own = new Faces();
console.log(Object.keys(own).length, own["\u{1F600}"], typeof own[joined]);
