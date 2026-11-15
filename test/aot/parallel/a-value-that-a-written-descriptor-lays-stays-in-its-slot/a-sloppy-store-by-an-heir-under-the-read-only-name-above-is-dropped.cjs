function put(heir) { heir.mark = 5; return heir.mark + " " + Object.hasOwn(heir, "mark"); }
const above = {}; Object.defineProperty(above, "mark", { value: 1, enumerable: true });
let said = "";
for (let turn = 0; turn < 300; turn++) { const answer = put(Object.create(above)); if (turn === 0 || turn === 299) said += answer + " "; }
console.log(said, above.mark);
