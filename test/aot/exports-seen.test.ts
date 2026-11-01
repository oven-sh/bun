import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/exports-seen";

// `bun run` names a nameless default function after its file. Compiled code names it "default", as the language does.
const held = cells().filter(cell => !cell.what.startsWith("default nameless function |"));
testCells("every form of export seen through every form of import", held, 1000, helpers, call);
