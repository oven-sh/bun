// ?? next to || or && with parentheses, and ?? next to ??.
var a, b, c; (a ?? b) || c;
var a, b, c; a ?? (b && c);
var a, b, c; a ?? b ?? c;
var a, b, c; (a || b) ?? c;
var a, b, c, x; x = (a || b) ?? c;
var a, b, c, x; x = a ?? (b || c);
var a, b, c, x; x = (a ?? b) && c;
