// The formatter runs every getter of native code above the event, though the program names none.
console.log(new CustomEvent("made up", { detail: { held: [1, 2] } }));
console.log([new MessageEvent("made up", { data: "text" })].length, { held: new ErrorEvent("made up", { message: "text" }) });
