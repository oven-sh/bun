// The code units of what was cut from a string: letters of a for-of loop (pairs of surrogates too), slices, substrings, characters by index, positions outside the piece.
function sumOfLetters(text: string): number {
  let sum = 0;
  for (const letter of text) sum += letter.charCodeAt(0);
  return sum;
}
function secondUnits(text: string): string {
  const units: number[] = [];
  for (const letter of text) units.push(letter.charCodeAt(1));
  return units.join(",");
}
function codePoints(text: string): string {
  const points: (number | undefined)[] = [];
  for (const letter of text) points.push(letter.codePointAt(0));
  return points.join(",");
}
function unitOfSlice(text: string, from: number, to: number, position: number): number {
  return text.slice(from, to).charCodeAt(position);
}
function unitOfSubstring(text: string, from: number, to: number, position: number): number {
  return text.substring(from, to).charCodeAt(position);
}
function unitOfPieceOfPiece(text: string, from: number, position: number): number {
  return text.slice(from).slice(1, 4).charCodeAt(position);
}
function unitOfEither(first: string, second: string, takeFirst: boolean, position: number): number {
  const piece = takeFirst ? first.slice(1, 3) : second.slice(2);
  return piece.charCodeAt(position);
}
const texts = ["iteration", "", "a", "né", "a\u{1F600}b", "\uD83D", "\uDE00\uD83D", "x".repeat(40) + "yz", "left" + String(Date.now() > 0 ? "-right" : "")];
for (const text of texts) {
  console.log(JSON.stringify(text.length), sumOfLetters(text), secondUnits(text), codePoints(text));
  for (const from of [0, 1, 3, -2, 50, 1.5, NaN])
    for (const to of [0, 2, 5, -1, 60])
      for (const position of [0, 1, 2, -1, 7, 0.5, NaN])
        console.log(unitOfSlice(text, from, to, position), unitOfSubstring(text, from, to, position), unitOfPieceOfPiece(text, from, position));
  for (const position of [0, 1, 2, 3, -1]) console.log(unitOfEither(text, "second", true, position), unitOfEither("first", text, false, position));
}
