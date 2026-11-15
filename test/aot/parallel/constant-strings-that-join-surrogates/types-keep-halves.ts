// TypeScript 7 keeps the halves of a surrogate pair apart in the types of these constants and reports each line for it.
// The program has one character, as without types.
const high = "\ud83d", low = "\ude00", whole = "\u{1F600}";
function unwrap<Text extends string>(text: `${Text}`): Text {
    return text as unknown as Text;
}
const unwrapped = unwrap(`${"\ud83d" + "\ude00"}`);
console.log(unwrapped.length, [...unwrapped].length, unwrapped.codePointAt(0), (unwrapped as string) === whole);
const same: "\u{1F600}" = `${high}${low}`;
console.log(same === whole, same.codePointAt(0));
enum Face {
    Grin = "\ud83d" + "\ude00",
    Smile = "\u{1F600}",
}
function isSmile(face: Face): boolean {
    return face === Face.Smile;
}
console.log(isSmile(Face.Grin), Face.Grin === (Face.Smile as Face));
switch (same) {
    case `${high}${low}`:
        console.log("case");
        break;
    default:
        console.log("default");
}
const counts: Record<"\u{1F600}", number> = { [`${high}${low}`]: 3 };
console.log(counts[whole], counts["\u{1F600}"]);
