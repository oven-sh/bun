// The application says "sideEffects": false. Of shape.ts the program uses only a type: the one function that names a value of it is never called. So the file is not in the executable, and the type still has its layout.
import { unused, type Shape } from "./shape";

function nobodyCallsThis(): number {
  return unused();
}

const shape: Shape = { size: 2 };
console.log(shape.size);
