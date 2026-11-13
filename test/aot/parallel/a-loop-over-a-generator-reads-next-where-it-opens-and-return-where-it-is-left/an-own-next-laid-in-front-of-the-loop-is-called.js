// A loop reads `next` once, where it opens: what is laid on the generator in front of that is what the loop steps by.
function* count() { yield 1; yield 2; }
function turns(made, lays) { if (lays) made.next = () => ({ done: true, value: undefined }); let seen = 0; for (const each of made) seen += each; return seen; }
let said = "";
for (let round = 0; round < 300; round++) { const seen = turns(count(), round % 3 === 0); if (round > 296) said += seen + " "; }
console.log(said);
