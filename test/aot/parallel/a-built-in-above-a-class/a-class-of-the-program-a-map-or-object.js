function below(kind) { let top = Object; if (kind) top = kind.top; class Below extends top {} return Below; }
class One { one() { return 1; } } console.log(new (below({ top: One }))().one(), new (below({ top: Map }))([[1, 2]]).get(1), typeof new (below())().hasOwnProperty);
