// A member of the namespace of a CommonJS file is called like a name imported from one.
import { add, low } from "./names-of-a-commonjs-file.cjs";
import * as whole from "./the-namespace-of-a-commonjs-file.cjs";
export const loops = {
  "names imported from a CommonJS file": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + add(i, 1) + low(i)) | 0; return s; },
  "members of the namespace of a CommonJS file": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + whole.add(i, 1) + whole.low(i)) | 0; return s; },
};
