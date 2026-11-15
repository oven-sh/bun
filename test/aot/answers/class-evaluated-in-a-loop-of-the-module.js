// answers: without-library
// # A class in a loop of the body of a module is evaluated several times: an allocation has to take the prototype object of its own new.target.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
const classes = [null, null, null];
for (let turn = 0; turn < 3; turn++) { classes[turn] = class Turn { constructor() { this.turn = turn } name() { return "turn " + turn } static which() { return turn } }; }
const objects = [new classes[0](), new classes[1](), new classes[2]()];
for (let index = 0; index < 3; index++) { report(objects[index].name()); }
for (let index = 0; index < 3; index++) { report(objects[index].turn); }
for (let index = 0; index < 3; index++) { report(classes[index].which()); }
report(objects[0] instanceof classes[0]);
report(objects[0] instanceof classes[1]);
report(Object.getPrototypeOf(objects[1]) === classes[1].prototype);
report(Object.getPrototypeOf(objects[1]) === classes[2].prototype);
report("end");
