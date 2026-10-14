import { cases } from "./packages/patching-globals";
import { packages } from "./packages/run-packages";

packages("patching-globals", cases, 1, 2);
