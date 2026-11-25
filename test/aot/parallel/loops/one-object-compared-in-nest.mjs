// The finder's program and its plain form: the list holds one object, so the read in front of the loops gives nothing.
const counted = (list, count) => { let i = 0; do { for (let j = 0; j < 3; j++) { if (list[count] < 2) break; } } while (++i < 3); for (let k = 0; k < count; k++) { } return i; };
console.log(counted([{ size: undefined }], 4));
