// fuzz/jsx-of-every-form-given-to-a-factory-of-the-program.ts: elements, attributes and children of every form, under each way to say which functions JSX calls.
// The functions are the program's own and print what they are called with.
import { endless } from "../family";
import { generate, modes } from "../jsx-of-every-form-given-to-a-factory-of-the-program";
import { Random } from "../random";

export default endless("jsx of every form given to a factory of the program", index => ({
  name: `seed ${index + 1}, ${modes[index % modes.length]}.`,
  make: () => ({ file: "main.tsx", ...generate(new Random(index + 1), modes[index % modes.length]) }),
}));
