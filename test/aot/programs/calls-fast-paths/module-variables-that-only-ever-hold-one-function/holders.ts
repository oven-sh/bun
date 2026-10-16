// Each variable holds a function. What differs is what is ever stored to it, and by whom.
export type Count = () => number;
export function five(): number { return 5; }
export function six(): number { return 6; }

let storedAgain: Count = five;
export function resetStoredAgain(): void { storedAgain = five; }
export function callStoredAgain(): number { return storedAgain() + 1; }

let bySetter: Count = five;
export function setBySetter(fn: Count): void { bySetter = fn; }
export function callBySetter(): number { return bySetter() + 1; }

let overTwoLevels: Count = five;
function setOverTwoLevelsInside(fn: Count): void { overTwoLevels = fn; }
export function setOverTwoLevels(fn: Count): void { setOverTwoLevelsInside(fn); }
export function callOverTwoLevels(): number { return overTwoLevels() + 1; }

let savedAndPutBack: Count = five;
export function shuffleSavedAndPutBack(): void { const before = savedAndPutBack; savedAndPutBack = five; savedAndPutBack = before; }
export function callSavedAndPutBack(): number { return savedAndPutBack() + 1; }

let chosen: Count = five;
export function chooseChosen(flag: boolean): void { chosen = flag ? five : five; }
export function callChosen(): number { return chosen() + 1; }

let anArrow: Count = () => 7;
export function setAnArrow(fn: Count): void { anArrow = fn; }
export function callAnArrow(): number { return anArrow() + 1; }

let aSecondFunction: Count = five;
export function setASecondFunction(fn: Count): void { aSecondFunction = fn; }
export function callASecondFunction(): number { return aSecondFunction() + 1; }

let mayBeNothing: Count | undefined = five;
export function setMayBeNothing(fn: Count | undefined): void { mayBeNothing = fn; }
export function callMayBeNothing(): number { return (mayBeNothing?.() ?? -1) + 1; }

let setLate: Count;
export function setSetLate(fn: Count): void { setLate = fn; }
export function callSetLate(): number { return setLate() + 1; }

let setterIsAValue: Count = five;
export function setSetterIsAValue(fn: Count): void { setterIsAValue = fn; }
export function callSetterIsAValue(): number { return setterIsAValue() + 1; }

let fromUntypedCode: Count = five;
export function setFromUntypedCode(fn: Count): void { fromUntypedCode = fn; }
export function callFromUntypedCode(): number { return fromUntypedCode() + 1; }

let whatACallYields: Count = five;
export function setWhatACallYields(fn: Count): void { whatACallYields = fn; }
export function callWhatACallYields(): number { return whatACallYields() + 1; }

export let exportedVariable: Count = five;
export function setExportedVariable(fn: Count): void { exportedVariable = fn; }
export function callExportedVariable(): number { return exportedVariable() + 1; }

let parameterIsAssigned: Count = five;
export function setParameterIsAssigned(fn: Count): void { if (fn === five) fn = six; parameterIsAssigned = fn; }
export function callParameterIsAssigned(): number { return parameterIsAssigned() + 1; }

let withDefault: Count = five;
export function setWithDefault(fn: Count = six): void { withDefault = fn; }
export function callWithDefault(): number { return withDefault() + 1; }
