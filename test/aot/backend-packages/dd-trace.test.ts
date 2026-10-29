import { testPrograms } from "./each-program";

testPrograms("dd-trace", {
  ddtrace: {
    differs:
      "it traces Express by a hook on the loader, which does not see a `require()` of a constant path in an executable",
  },
});
