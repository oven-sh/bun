import { testPrograms } from "./each-program";

testPrograms("opentelemetry", {
  otel: {
    differs:
      "it traces node:http and Express by a hook on the loader, which does not see a `require()` of a constant path in an executable",
  },
});
