// answers: with-library
// # A class expression in a loop is evaluated on every turn. A method of each object reads the variable of the turn in which its class was evaluated.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
function scene() { const made: { read(): number }[] = []; for (let i = 0; i < 3; i++) { const mine = String(i); made.push(new (class { kept = mine.length; read() { return this.kept * 2 + mine.length; } })()); } for (let more = 0; more < 3; more++) made.push(new (class { kept = more * 7; read() { return this.kept * 2 + more * 7; } })()); let said = ""; for (const each of made) said += each.read() + "-"; return said; }
report(scene()); report(scene());
report("end");
