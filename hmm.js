import { executionCount } from "bun:jsc";
function wrapper() {
  console.countReset("Real count");
  function hey() {
    console.count("Real count");
  }

  console.log("Reported count", executionCount(hey));

  for (let i = 0; i < 10; i++) {
    hey();
    console.log("Reported count", executionCount(hey));
  }

  hey();
  console.log("Reported count", executionCount(hey));
}

wrapper();
wrapper();
