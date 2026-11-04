// Another file stores to the members of an enum, redefines and deletes them. `bun build` has the value of a member in place of every read by name, in every file, so no such read sees any of it. `bun run` reads the object outside the file of the enum.
// `bun build --compile` itself prints `0 = 9` for `Color.Red = 9` and does not start. The output is what it prints where each target of a store is written `(0, Color).Red`, which changes no read.
import { Color, Level, Mode, Shape, Size, Fixed, Merged, Keyed, Assigned, Defined, Reflected, Untouched, colorInside, levelInside, mergedInside } from "./enums.ts";
import * as all from "./enums.ts";
import { castAndStore, readColor, readLevel, readSize, readThroughNamespace, readKeyed, readAssigned, readDefined, readReflected, readUntouched } from "./reader.ts";

Color.Red = 9;
console.log(Color.Red, Color["Red"], Color.Green, readColor(), colorInside());

Level.Low++;
Level.Low += 1;
--Level.High;
console.log(Level.Low, Level["Low"], Level.High, readLevel(), levelInside());

delete Mode.On;
console.log(Mode.On, Mode["On"], Mode.Off, "On" in Mode);

[Shape.Round] = [5];
({ x: Shape.Square } = { x: 6 });
for (Shape.Flat of [7]);
console.log(Shape.Round, Shape.Square, Shape.Flat, Shape.Tall);

castAndStore();
console.log(Size.Small, Size["Small"], Size.Large, readSize());

Fixed.One = 11;
console.log(typeof Fixed, Fixed.One, Fixed.Two);

Merged.First = 21;
Merged.Second = 22;
console.log(Merged.First, Merged.Second, mergedInside());

all.ThroughNamespace.Near = 31;
console.log(all.ThroughNamespace.Near, all.ThroughNamespace.Far, readThroughNamespace());

const key = ["Left"][0];
Keyed[key] = 41;
console.log(Keyed.Left, Keyed.Right, readKeyed());

Object.assign(Assigned, { Up: 51 });
console.log(Assigned.Up, Assigned.Down, readAssigned());

Object.defineProperty(Defined, "In", { value: 61 });
Object.defineProperties(Defined, { Out: { value: 62 } });
console.log(Defined.In, Defined.Out, readDefined());

Reflect.set(Reflected, "Open", 71);
Reflect.defineProperty(Reflected, "Shut", { value: 72 });
Reflect.deleteProperty(Reflected, "Ajar");
console.log(Reflected.Open, Reflected.Shut, Reflected.Ajar, readReflected());

console.log(Untouched.One, Untouched["Two"], readUntouched());
/* Output:
0 0 1 0 0
0 0 10 10 10
on on off false
0 1 2 3
1 1 2 3
object 1 2
1 2 3
1 2 3
1 2 3
1 2 3
1 2 3
1 2 3 3
1 2 3
*/
