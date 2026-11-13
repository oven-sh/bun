// The idioms of JetStream 3's programs may take so many times the instructions of their everyday spelling. Both are measured in the same executable.
// A row that is not met yet is in gap(), with what it takes today: it is measured at every run and is red once it is met.
import { join } from "path";
import { gap } from "../supported";
import { describeTwins, type CountedRow, type Row } from "./twins";

const rows: Row[] = [
  ["inheritance.cjs", "a class that extends", "no parent", 1.5],
  ["inheritance.cjs", "a class that extends", "Object.create", 1.5],
  ["inheritance.cjs", "a class that extends", "Babel", 1.5],
  ["inheritance.cjs", "a class that extends", "TypeScript", 1.5],
  ["inheritance.cjs", "a class that extends", "an instance of the parent", 1.5],
  // It takes 46 instructions, 44 where 2.4 times was written: the test of its class asks once more whether a value that a check has passed is an object.
  gap("2.6 times", ["inheritance.cjs", "a class that extends", "util.inherits", 1.5]),
  ["inheritance.cjs", "a class that extends", "__proto__ in a literal", 1.5],
  ["inheritance.cjs", "a class that extends", "__proto__ assigned", 1.5],
  ["inheritance.cjs", "a class that extends", "Object.setPrototypeOf", 1.5],
  ["inheritance.cjs", "a class that extends", "two children of one parent", 2.5],
  // Its twin takes 22 instructions, 32 where 1.2 was written: 29 over 22, 32 over 32 then.
  ["mixins.cjs", "a class below a mixin of a class", "a class below a mixin of Object", 1.4],
  ["mixins.cjs", "a class", "a class below a mixin of a class", 1.6],
  ["mixins.cjs", "a list", "a list below a mixin of Array", 1.2],
  ["dynamic-mixins.cjs", "a class from a table", "a class below a mixin from a table", 1.6],
  ["dynamic-mixins.cjs", "a class from a table", "a class below two mixins from a table", 2.6],
  ["fields.cjs", "in the constructor", "in a literal", 1.2],
  gap("1.3 times", ["fields.cjs", "in the constructor", "by another function", 1.2]),
  ["fields.cjs", "in the constructor", "by a method through an alias", 1.2],
  gap("1.3 times", ["fields.cjs", "in the constructor", "by the caller of a class's constructor", 1.2]),
  gap("1.3 times", ["fields.cjs", "in the constructor", "by Object.assign", 1.2]),
  ["fields.cjs", "in the constructor", "by a spread", 1.2],
  ["assign-helpers.cjs", "Object.assign({}, line)", "assign({}, line)", 1.3],
  ["assign-helpers.cjs", "Object.assign({}, line)", "__assign({}, line)", 1.5],
  // Its twin takes 9 instructions, 16 where 4 was written: 44 over 9.
  ["fields.cjs", "in the constructor", "by JSON.parse", 5],
  ["assign-helpers.cjs", "Object.assign({}, line)", "_extends({}, line)", 1.3],
  // Its twin takes 9 instructions, 16 where 1.3 was written: 14 over 9, 18 over 16 then.
  ["fields.cjs", "in the constructor", "one of them by another function", 1.6],
  ["fields.cjs", "in the constructor", "under computed keys", 2],
  gap("1.3 times", ["fields.cjs", "in the constructor", "by Object.assign on this", 1.2]),
  ["constructors.cjs", "a class", "methods assigned to the prototype", 1.2],
  ["constructors.cjs", "a class", "this.init(x, y)", 1.2],
  ["constructors.cjs", "a class", "this.init.call(this, x, y)", 1.2],
  ["constructors.cjs", "a class", "this.init.apply(this, [x, y])", 1.2],
  ["constructors.cjs", "a class", "this.init.apply(this, arguments), strict", 1.2],
  ["constructors.cjs", "a class", "this.init.apply(this, arguments)", 1.2],
  ["constructors.cjs", "a class", "this.init.apply(this, rest)", 1.2],
  ["constructors.cjs", "a class", "this.init(...rest)", 1.2],
  ["constructors.cjs", "a class", "Static.make.apply(this, arguments)", 1.5],
  ["constructors.cjs", "a class", "Class.create()", 1.2],
  ["matrices.cjs", "in a field", "a class that extends Array", 1.5],
  ["matrices.cjs", "in a field", "a class that extends a mixin of Array", 1.5],
  ["matrices.cjs", "in a field", "products of rows", 3],
  ["matrices.cjs", "a nest of loops", "a callback that calls a function of a table", 7],
  ["heirs.cjs", "statics of a class", "statics of a class that extends Array", 1.2],
  ["heirs.cjs", "statics of a class", "statics of a class that the loop does not name", 1.25],
  ["heirs.cjs", "statics of a class", "species of a class", 1.3],
  ["heirs.cjs", "statics of a class", "species of a class that extends Array", 1.2],
  ["heirs.cjs", "statics of a class", "statics of a class below a mixin", 2.3],
  ["heirs.cjs", "another instance, by a name of its own", "another instance, by a name that built-ins have", 1.5],
  ["heirs.cjs", "a property of a function", "a property of the function above", 1.6],
  ["namespaces.cjs", "a constructor of the file", "a constructor in a namespace, its fields in a method", 1.5],
  ["direct-eval.cjs", "no direct eval", "a direct eval in a sibling function", 1.2],
  ["direct-eval.cjs", "a built-in", "a built-in beside evals of constant strings", 1.2],
  // Its twin takes 12 instructions, 18 where 1.3 was written: 17 over 12, 21 over 18 then.
  ["generators.ts", "the same elements by index", "for-of", 1.5],
  ["generators.ts", "the same elements by index", "next() by hand", 1.8],
  ["statics.ts", "a field of a literal read", "a static field read", 1],
  gap("3.3 times", ["statics.ts", "a counter in a literal", "a counter in a private static field", 1.5]),
  // Its twin takes 7 instructions, 11 where 1.6 was written: 17 over 7, 17 over 11 then.
  ["statics.ts", "a counter in a literal", "a counter on a function", 2.8],
  ["arrays.ts", "new Array(a const)", "new Array(a let)", 1.2],
  ["arrays.ts", "new Array(a const)", "new Array(a var)", 1.2],
  gap("37 times", ["arrays.ts", "an array of nine literal elements", "new Array(a parameter)", 5]),
  gap("3 times", ["arrays.ts", "the last element by its index", "the last element by at(-1)", 1.5]),
  ["unknown-values.cjs", "a field read behind a call", "a field of an unknown object read behind a call", 2.6],
  ["unknown-values.cjs", "the length of an array", "the length of an unknown array", 4],
  ["unknown-values.cjs", "the length of a string", "the length of an unknown string", 4],
  ["unknown-values.cjs", "a field written", "a field of an unknown object written", 4],
  ["unknown-values.cjs", "a typed array in a field", "a typed array in a field of an unknown object", 4],
  gap("3.9 times", ["unknown-values.cjs", "characters of a string", "characters of an unknown string", 2]),
  ["variables.ts", "a const", "a var", 1.2],
  ["variables.ts", "a field of a local object", "a field of a module's object", 2.6],
  ["variables.ts", "an element of an array", "an entry of a Map", 7.5],
];

const counted: CountedRow[] = [
  // It takes 8 instructions, as it did when 1.7 times those of a field of a literal were written: 5.25 then, 3.25 since that field holds integers.
  ["statics.ts", "a static field written", 8.5],
];

describeTwins("jetstream-idioms", join(import.meta.dir, "jetstream-idioms"), rows, file => file, counted);
