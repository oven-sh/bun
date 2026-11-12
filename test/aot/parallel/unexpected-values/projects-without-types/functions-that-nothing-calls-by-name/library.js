export function byAComputedName() {
  return "byAComputedName ran";
}
export function byEvaluatedText() {
  return "byEvaluatedText ran";
}
export function byAFunctionMadeOfText() {
  return "byAFunctionMadeOfText ran";
}
export function throughTheGlobalObject() {
  return "throughTheGlobalObject ran";
}
export function byATimer() {
  return "byATimer ran";
}
export function byATick() {
  return "byATick ran";
}
export function byAMicrotask() {
  return "byAMicrotask ran";
}
export function byAReaction() {
  return "byAReaction ran";
}
export function byMap() {
  return "byMap ran";
}
export function byReplace() {
  return "byReplace ran";
}
export function asAGetter() {
  return "asAGetter ran";
}
export function asASetter() {
  return "asASetter ran";
}
export function asValueOf() {
  return "asValueOf ran";
}
export function asToString() {
  return "asToString ran";
}
export function asToPrimitive() {
  return "asToPrimitive ran";
}
export function asToJSON() {
  return "asToJSON ran";
}
export function asATrap() {
  return "asATrap ran";
}
export function asAReviver() {
  return "asAReviver ran";
}
export function asAListener() {
  return "asAListener ran";
}
export function asATag() {
  return "asATag ran";
}
export function asADefault() {
  return "asADefault ran";
}
export function byCall() {
  return "byCall ran";
}
export function byApply() {
  return "byApply ran";
}
export function byBind() {
  return "byBind ran";
}
export function byReflectApply() {
  return "byReflectApply ran";
}
export function byCallOfCall() {
  return "byCallOfCall ran";
}
export function atExit() {
  return "atExit ran";
}
export function asAnIterator() {
  return ["asAnIterator ran"][Symbol.iterator]();
}
export function asThen(resolve) {
  resolve("asThen ran");
}
export function asHasInstance() {
  return true;
}
export function bySort() {
  ran.push("bySort ran");
  return 0;
}
export function asAConstructor() {
  this.said = "asAConstructor ran";
}
export function byReflectConstruct() {
  this.said = "byReflectConstruct ran";
}
export const ran = [];
