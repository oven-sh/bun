// The first wait stands right behind the call, but the promise has a name: the second wait sees what was laid on it since.
const held = new Response("made up").text();
console.log(await held);
held.constructor = undefined;
held.then = resolve => resolve({ answered: "by the program" });
const text = await held;
console.log(typeof text, text.answered);
