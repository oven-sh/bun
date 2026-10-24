// Array and object literals that are not valid assignment patterns, and { a = 1 } where no pattern is expected.
[...a, b] = c;
[...a = 1] = c;
[...a,] = c;
({ ...a, b } = c);
({ ...{ a } } = c);
({ ...[a] } = c);
({ m() {} } = c);
({ get a() {} } = c);
[a()] = c;
({ a: 1 } = c);
[a?.b] = c;
({ a: b() } = c);
[[a + 1]] = c;
({ a = 1 });
f({ a = 1 });
[([a])] = c;
({ a: ({ b }) } = c);
