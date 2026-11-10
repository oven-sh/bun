function define(params) { const Parent = params?.Parent ?? Object; class Definition extends Parent {} return Definition; }
class One { one() { return 1; } } console.log(new (define({ Parent: One }))().one(), new (define({ Parent: Map }))([[1, 2]]).get(1), typeof new (define())().hasOwnProperty);
