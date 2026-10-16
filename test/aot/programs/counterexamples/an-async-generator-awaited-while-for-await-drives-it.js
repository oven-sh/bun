// An async function awaits the generator object while `for await` drives that async generator.
let g;
async function* ag() { (async () => console.log((await g) === g))(); await 0; }
(async () => { for await (const v of g = ag()); console.log("end"); })();
