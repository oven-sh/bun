// The conversion runs the code of what is stored, which has the receiver by a variable and writes on it.
const place = new URL("http://host.example/path");
place.note = 1;
const text = { toString() { place.note = "changed"; delete place.gone; return "made"; } };
place.gone = true;
place.hash = text;
console.log(place.hash, place.note, "gone" in place);
