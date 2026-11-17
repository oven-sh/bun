enum State {
  Ready,
  Done,
  Name = "name",
}
function nameOf(state: State.Ready | State.Done): string {
  return State[state];
}
let length = 0;
for (let turn = 0; turn < 300; turn++) length += nameOf(turn % 2 === 0 ? State.Ready : State.Done).length + State.Done;
console.log(length, Object.keys(State).join(), State.Name);
