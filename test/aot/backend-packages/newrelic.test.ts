import { testPrograms } from "./each-program";

testPrograms("newrelic", {
  newrelic: {
    forms: ["as one file"],
    given: ["node_modules/newrelic/lib/subscribers/**/*.js", "node_modules/newrelic/lib/instrumentation/**/*.js"],
  },
});
