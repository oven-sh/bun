// A list of programs from ../generators/typed-array-kinds-under-subclasses.ts, which describes them.
import { family, type Member } from "../family";
import { everyCase, program } from "../generators/typed-array-kinds-under-subclasses";

const programs: Member[] = everyCase.map(name => ({
  name,
  make: () => program(name),
}));

export default family("typed array kinds under subclasses", programs);
