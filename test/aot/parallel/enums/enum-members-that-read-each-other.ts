// @ts-nocheck
enum Ring { A = Ring.B, B = Ring.A }
enum Self { A = Self.A }
enum Bare { A = B, B = A }
enum Sum { A = 1 + Sum.B, B = 1 + Sum.A }
function inner() { enum Local { A = Local.B, B = Local.A } return Local.A; }
console.log(Ring.A, Ring.B, Self.A, Bare.A, Bare.B, Sum.A, Sum.B, inner());
