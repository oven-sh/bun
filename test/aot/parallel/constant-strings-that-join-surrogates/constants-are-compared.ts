const high = "\ud83d", low = "\ude00", whole = "\u{1F600}";
const joined = `${high}${low}`;
console.log(joined === whole, high + low === whole);
enum Face {
    Grin = `\ud83d${low}`,
    Beam = "\ud83d" + "\ude01",
}
console.log(Face.Grin === (whole as Face), Face.Beam.length, Face.Beam.codePointAt(0));
const broken = `${low}${high}`;
console.log(broken.length, broken.isWellFormed());
