// Programs of ../jsx-with-custom-factory.ts, one per seed. That file describes them.
import { endless } from "../family";
import { generate, modes } from "../jsx-with-custom-factory";
import { Random } from "../random";

export default endless("jsx with custom factory", index => ({
  name: `seed ${index + 1}, ${modes[index % modes.length]}.`,
  make: () => ({ file: "main.tsx", ...generate(new Random(index + 1), modes[index % modes.length]) }),
}));
