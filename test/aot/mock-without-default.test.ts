import { answersAsPlainBunTest } from "./harness/mock-without-default";

answersAsPlainBunTest([{ flags: [] }, { flags: ["--isolate"], words: "TestRunLayers:0" }]);
