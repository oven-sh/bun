// answers: without-library
// # From three texts of one length on, a switch over texts reads a word of the subject's characters to tell them apart, and only then compares in full: a text over 32 characters off the cell.
// # A rope and a 16-bit string have their characters written down by a stub, as far as its room goes: 128. OF A LONGER SUBJECT NOTHING IS WRITTEN DOWN, AND WHAT LIES THERE IS WHAT AN EARLIER CALL LEFT.
// # With a room of 32 and the word read of texts of any length, of twelve paths, three of 36 characters and three of 37, asked for as ropes, four fell to `default`, silently.
// # So in front of each subject here comes a rope that leaves the head of ANOTHER text in that room.
// # f1 = of36, f2 = of128, f3 = of129
// # three texts that the room holds are told apart by a word of the characters: they differ at 18 and at 64, the word of four bytes that ends there begins at 15 and at 61
// # RUN(HELD): emit f1:Body mechanisms=all
// # HELD: offset = 15, characters8
// # RUN(FULL): emit f2:Body mechanisms=all
// # FULL: offset = 61, characters8
// # of three texts that it does not hold no character is read but those of "host"; they are compared off the cell, one after the other. The length that was written down is read off the same heap, at 0.
// # RUN(LONGER): emit f3:Body mechanisms=all
// # LONGER-NOT: offset = 61, characters8
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 11 of 11 of 11
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function of36(subject: unknown, depth: number): number { if (depth > 0) return of36(subject, depth - 1); switch (subject) { case "dkryfmtahovcjqxelsAgnubipwdkryfmtaho": return 1; case "dkryfmtahovcjqxelsBgnubipwdkryfmtaho": return 2; case "dkryfmtahovcjqxelsCgnubipwdkryfmtaho": return 3; case "host": return 9; default: return 0; } }
function of128(subject: unknown, depth: number): number { if (depth > 0) return of128(subject, depth - 1); switch (subject) { case "dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcAqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubi": return 1; case "dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcBqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubi": return 2; case "dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcCqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubi": return 3; case "host": return 9; default: return 0; } }
function of129(subject: unknown, depth: number): number { if (depth > 0) return of129(subject, depth - 1); switch (subject) { case "dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcAqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubip": return 1; case "dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcBqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubip": return 2; case "dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcCqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubip": return 3; case "host": return 9; default: return 0; } }
function rope(text: string): string { const half = text.length >> 1; return text.slice(0, half) + text.slice(half); }
function wide(text: string): string { return ("€" + text).split("€").join(""); }
function widePiece(text: string): string { return (JSON.parse(JSON.stringify("€" + text)) as string).slice(1); }
function asked(pick: (subject: unknown, depth: number) => number, keys: string[], text: string): string { let said = ""; for (let k = 0; k < keys.length; k++) { const key = keys[k]; for (let room = 32; room <= 128; room += 96) { pick(rope(key.slice(0, room)), 1); said += pick(rope(text), 1); pick(rope(key.slice(0, room)), 1); said += pick(rope(text).slice(0), 1); pick(rope(key.slice(0, room)), 1); said += pick(wide(text), 1); pick(rope(key.slice(0, room)), 1); said += pick(widePiece(text), 1); said += pick(text, 1); } } return said; }
const keys36: string[] = JSON.parse("[\"dkryfmtahovcjqxelsAgnubipwdkryfmtaho\", \"dkryfmtahovcjqxelsBgnubipwdkryfmtaho\", \"dkryfmtahovcjqxelsCgnubipwdkryfmtaho\"]");
const keys128: string[] = JSON.parse("[\"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcAqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubi\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcBqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubi\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcCqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubi\"]");
const keys129: string[] = JSON.parse("[\"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcAqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubip\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcBqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubip\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcCqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubip\"]");
for (let i = 0; i < keys36.length; i++) report(asked(of36, keys36, keys36[i]));
for (let i = 0; i < keys128.length; i++) report(asked(of128, keys128, keys128[i]));
for (let i = 0; i < keys129.length; i++) report(asked(of129, keys129, keys129[i]));
report(asked(of36, keys36, keys36[0].slice(0, 35) + "?") + asked(of128, keys128, keys128[1] + "x") + asked(of129, keys129, keys129[2].slice(1) + "?"));
report("end");
