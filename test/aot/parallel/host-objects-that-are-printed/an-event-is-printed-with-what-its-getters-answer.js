// The formatter runs every getter of native code above the event, though the program names none.
// timeStamp is the time the event was made, and so differs between two runs.
const withoutTime = text => text.replace(/timeStamp: [\d.]+/g, "timeStamp: N");
console.log(withoutTime(Bun.inspect(new CustomEvent("made up", { detail: { held: [1, 2] } }))));
console.log(
  [new MessageEvent("made up", { data: "text" })].length,
  withoutTime(Bun.inspect({ held: new ErrorEvent("made up", { message: "text" }) })),
);
