// The left side of an assignment is not a name, a member access or an unparenthesized pattern.
1 = 2;
a() = 1;
a?.b = 1;
a?.[0] = 1;
this = 1;
import.meta = 1;
(a, b) = 1;
a + b = 1;
([a]) = 1;
({ a }) = 1;
[a] += 1;
a() += 1;
a?.b ||= 1;
(a = 1) = 2;
function f() { new.target = 1; }
