// The expression before in or of is not a valid assignment target.
for (1 of []) {}
for (a() of []) {}
for (a?.b of []) {}
for (a() in {}) {}
for (a = 1 of []) {}
for ([a()] of []) {}
for ({ a: 1 } in {}) {}
for ((a, b) of []) {}
for ([...a, b] of []) {}
