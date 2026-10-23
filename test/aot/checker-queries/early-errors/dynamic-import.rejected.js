// import() takes one or two arguments and no spread. It cannot be the operand of new or an assignment target.
import();
import(a, b, c);
import(...a);
import(a, ...b);
new import(a);
new import(a).b;
new import(a)[0]();
import(a) = 1;
