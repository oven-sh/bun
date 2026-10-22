// A module variable to which, by every store in the program, closures of one function are stored and nothing else: calls of it are calls of that function. And the ways in which that is not so.
// IR+ ^variable g\d+ name="storedAgain" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="bySetter" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="overTwoLevels" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="savedAndPutBack" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="chosen" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="exportedVariable" .*declared=f\d+( |$)
// IR- ^variable g\d+ name="(anArrow|aSecondFunction|mayBeNothing|setLate|setterIsAValue|fromUntypedCode|whatACallYields|parameterIsAssigned|withDefault)" .*declared=f\d+( |$)
import * as holders from "./holders.ts";
import { five, six, type Count } from "./holders.ts";
import { storeFromUntypedCode } from "./untyped.js";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function attempt(label: string, body: () => unknown): void { try { say(label, body()); } catch (error) { say(label, "threw " + (error as Error).constructor.name); } }
function yields(flag: boolean): Count { return flag ? six : five; }

holders.resetStoredAgain(); say("storedAgain", holders.callStoredAgain());
holders.setBySetter(five); holders.setBySetter(five); say("bySetter", holders.callBySetter());
holders.setOverTwoLevels(five); say("overTwoLevels", holders.callOverTwoLevels());
holders.shuffleSavedAndPutBack(); say("savedAndPutBack", holders.callSavedAndPutBack());
holders.chooseChosen(lines.length > 2); say("chosen", holders.callChosen());
holders.setExportedVariable(five); say("exportedVariable", holders.callExportedVariable(), holders.exportedVariable === five);

say("anArrow", holders.callAnArrow()); holders.setAnArrow(five); say("anArrow", holders.callAnArrow());
say("aSecondFunction", holders.callASecondFunction()); holders.setASecondFunction(six); say("aSecondFunction", holders.callASecondFunction());
say("mayBeNothing", holders.callMayBeNothing()); holders.setMayBeNothing(undefined); say("mayBeNothing", holders.callMayBeNothing());
attempt("setLate", () => holders.callSetLate()); holders.setSetLate(five); say("setLate", holders.callSetLate());
const kept: ((fn: Count) => void)[] = [holders.setSetterIsAValue];
say("setterIsAValue", holders.callSetterIsAValue()); kept[lines.length - lines.length](six); say("setterIsAValue", holders.callSetterIsAValue());
say("fromUntypedCode", holders.callFromUntypedCode()); storeFromUntypedCode(true); say("fromUntypedCode", holders.callFromUntypedCode());
say("whatACallYields", holders.callWhatACallYields()); holders.setWhatACallYields(yields(lines.length > 3)); say("whatACallYields", holders.callWhatACallYields());
say("parameterIsAssigned", holders.callParameterIsAssigned()); holders.setParameterIsAssigned(five); say("parameterIsAssigned", holders.callParameterIsAssigned());
say("withDefault", holders.callWithDefault()); holders.setWithDefault(); say("withDefault", holders.callWithDefault());
console.log(lines.join("\n"));
