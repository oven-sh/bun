import { packages } from "./packages/run-packages";
import { cases } from "./packages/wrong-declarations";

packages("wrong-declarations", cases, 2, 2);
