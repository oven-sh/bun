import { answersAsPlainBunTest } from "./harness/mock-without-default";

answersAsPlainBunTest([{ flags: ["--isolate"], words: "TestRunLayers:3" }]);
