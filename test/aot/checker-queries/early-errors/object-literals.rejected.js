// Object literals with two __proto__: value properties, with a default outside of a pattern, or with a malformed property.
({ __proto__: 1, __proto__: 2 });
({ __proto__: 1, "__proto__": 2 });
({ a = 1 });
({ a, b = 1 });
({ async a: 1 });
({ static a() {} });
({ #a: 1 });
({ [a, b]: 1 });
({ if });
