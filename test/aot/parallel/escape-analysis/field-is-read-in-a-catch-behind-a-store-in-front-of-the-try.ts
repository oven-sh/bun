// A field is stored in front of a try and read in its catch, and what stands under the try stores into the field through another name before it throws.
class Box { value: unknown; constructor(value: unknown) { this.value = value; } }
function deed(box: Box, other: Box, stored: unknown, thrown: unknown) {
    box.value = stored;
    try {
        other.value = "through the other name";
        if (thrown) throw thrown;
    } catch {
        return box.value;
    }
    return box.value;
}
const one = new Box(0);
console.log(String(deed(one, new Box(1), "stored", "thrown")), String(deed(one, one, "stored", "thrown")), String(deed(one, one, "stored", 0)));
let letters = 0;
for (let i = 0; i < 20000; i++) letters += String(deed(one, i % 3 ? one : new Box(i), { text: i }, i % 2)).length;
console.log(letters);
