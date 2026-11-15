// Nobody but written requests names the file: join is followed to its call, and the rest of the file is not let go.
import { join, basename } from "node:path";
console.log(join("a", "b"), basename("/x/y.txt"));
