import { answersAsPlainBunTest } from "./harness/mock-without-default";

answersAsPlainBunTest([{ flags: ["--parallel=2", "--aot-memory-limit=1KB"] }]);
