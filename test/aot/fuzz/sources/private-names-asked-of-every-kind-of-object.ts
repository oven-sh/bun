// fuzz/private-names-asked-of-every-kind-of-object.ts: classes with private fields, methods, getters and setters, read, stored to, called and asked for in twenty ways, of instances,
// of instances of other classes, of the same class evaluated again, of proxies, of objects that were given the names by a constructor that returns them, and of what is no object.
import { generate } from "../private-names-asked-of-every-kind-of-object";
import { Random } from "../random";
import { endless } from "../family";

export default endless("private names asked of every kind of object", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
