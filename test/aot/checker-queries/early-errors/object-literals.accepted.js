// Repeated names are allowed. __proto__ counts only when written as name: value, and not in a pattern.
({ __proto__: 1, ["__proto__"]: 2 });
({ __proto__: 1, __proto__() {} });
var __proto__; ({ __proto__, __proto__: 1 });
({ a: 1, a: 2 });
({ get a() { return 1; }, a: 2 });
({ 1n: 1 });
({ async a() {}, *b() {}, async *c() {} });
({ if: 1, class: 2 });
var a, b, c; ({ __proto__: a, __proto__: b } = c);
