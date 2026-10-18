// In the place of Source/JavaScriptCore/builtins/GeneratorPrototype.js, which resumes a generator of bytecode.

$visibility = "Private";
export function next(value) {
  "use strict";

  const result = $stepGenerator(this, 0, value, 3);
  const status = $generatorStepStatus(result);
  if (status === 2) return $resumeGenerator(this, $GeneratorResumeModeNormal, value);
  return $makeIteratorResult(result, status === 1);
}

$overriddenName = "return";
$visibility = "Private";
export function return_(value) {
  "use strict";

  const result = $stepGenerator(this, 2, value, 3);
  const status = $generatorStepStatus(result);
  if (status === 2) return $resumeGenerator(this, $GeneratorResumeModeReturn, value);
  return $makeIteratorResult(result, status === 1);
}

$overriddenName = "throw";
$visibility = "Private";
export function throw_(exception) {
  "use strict";

  const result = $stepGenerator(this, 1, exception, 3);
  const status = $generatorStepStatus(result);
  if (status === 2) return $resumeGenerator(this, $GeneratorResumeModeThrow, exception);
  return $makeIteratorResult(result, status === 1);
}
