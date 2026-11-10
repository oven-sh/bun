// A loop reads `next` once, where it opens: what a turn lays on the generator does not change how the loop steps.
function* count() { yield 1; yield 2; yield 3; }
function turns(made, lays) { let seen = 0; for (const each of made) { if (lays) made.next = () => ({ done: true, value: undefined }); seen += each; } return seen; }
let said = "";
for (let round = 0; round < 300; round++) { const seen = turns(count(), round % 3 === 0); if (round > 296) said += seen + " "; }
console.log(said);
