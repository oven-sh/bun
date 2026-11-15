// Programs of ../class-fields-on-returned-object.ts, one per seed. That file describes them.
import { generate } from "../class-fields-on-returned-object";
import { Random } from "../random";
import { endless } from "../family";

export default endless("class fields on returned object", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
