// In the place of Source/JavaScriptCore/builtins/GeneratorPrototype.js, which resumes a generator of bytecode.

export function next(value) {
    "use strict";

    return $resumeGenerator(this, $GeneratorResumeModeNormal, value);
}

$overriddenName = "return";
export function return_(value) {
    "use strict";

    return $resumeGenerator(this, $GeneratorResumeModeReturn, value);
}

$overriddenName = "throw";
export function throw_(exception) {
    "use strict";

    return $resumeGenerator(this, $GeneratorResumeModeThrow, exception);
}
