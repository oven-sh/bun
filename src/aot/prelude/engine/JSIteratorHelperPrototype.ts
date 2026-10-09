// In the place of Source/JavaScriptCore/builtins/JSIteratorHelperPrototype.js, which resumes a generator of bytecode.

export function next() {
    "use strict";

    if (!$isIteratorHelper(this))
        throw new TypeError("|this| should be an iterator helper");

    return $resumeGenerator($getIteratorHelperInternalField(this, $iteratorHelperFieldGenerator), $GeneratorResumeModeNormal, undefined);
}

$overriddenName = "return";
export function return_() {
    "use strict";

    if (!$isIteratorHelper(this))
        throw new TypeError("|this| should be an iterator helper");

    var generator = $getIteratorHelperInternalField(this, $iteratorHelperFieldGenerator);
    if (!$isGeneratorSuspendedAtStart(generator))
        return $resumeGenerator(generator, $GeneratorResumeModeReturn, undefined);

    $resumeGenerator(generator, $GeneratorResumeModeReturn, undefined);
    var underlyingIterator = $getIteratorHelperInternalField(this, $iteratorHelperFieldUnderlyingIterator);
    if (underlyingIterator !== null)
        $iteratorGenericClose(underlyingIterator);
    return { value: undefined, done: true };
}
