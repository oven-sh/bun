// An async generator that `for await` drives awaits its own generator object.
const g = (async function* () { await g; })();
(async () => { for await (const v of g); console.log("end"); })();
