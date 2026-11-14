// STATISTIC: ContentsProofsChecked <= 0
'use strict';
const State = {};
State[State.New = 0] = 'New';
State[State.Paid = 1] = 'Paid';
State[State.Sent = 2] = 'Sent';
function nameOf(state) { return State[state]; }
let length = 0;
for (let turn = 0; turn < 60; turn++) length += nameOf(turn % 3).length + State.Paid;
console.log(length);
