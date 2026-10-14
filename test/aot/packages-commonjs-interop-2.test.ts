import { cases } from "./packages/commonjs-interop";
import { packages } from "./packages/run-packages";

packages("commonjs-interop", cases, 2, 3);
