// Prints the frames of errors that a conversion in a template throws. In front of it stands a statement whose expression Bun's transpiler prints as a literal: members of an enum, the length of a text and operators
// over those. Other forms read an object or call a function there.
function step<T>(value: T): T {
  throw new Error("step " + value);
}
function same<T>(value: T): T {
  return value;
}
const holder = { first: 1 };
function framesOf(error: unknown): string {
  return String((error as Error).stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/\(?[^ ()]*[\/\\][\w-]+\.ts:(\d+):(\d+)\)?/, "@$1:$2")
        .replace(/^at /, ""),
    )
    .join(" < ");
}
function lengthMemberFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function numberMemberFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function memberPlusNumberFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function lengthMemberPlusNumberFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.Second + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function twoMembersFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function memberInBracketsFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind["First"] + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function lengthOfTextFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = 1 + "ab".length;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function negatedMemberFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = -Kind.First;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function typeofNumberFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = typeof 1 + "a";
  return `${{ toString: () => String(step(55)) }}`.length;
}
function comparisonFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First === 53;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function declaredWithLetFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  let value = Kind.First + Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function statementFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  Kind.First + Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function valueIsReadFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + Kind.Second;
  framesOf.length + value;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function memberOfObjectFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = holder.first + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function callInSumFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + same(1);
  return `${{ toString: () => String(step(55)) }}`.length;
}
function sumInCallFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = same(Kind.First + Kind.Second);
  return `${{ toString: () => String(step(55)) }}`.length;
}
function sumInListFirst() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = [Kind.First + Kind.Second, holder.first];
  return `${{ toString: () => String(step(55)) }}`.length;
}
function lengthMemberBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function numberMemberBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function memberPlusNumberBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function lengthMemberPlusNumberBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.Second + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function twoMembersBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function memberInBracketsBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind["First"] + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function lengthOfTextBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = 1 + "ab".length;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function negatedMemberBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = -Kind.First;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function typeofNumberBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = typeof 1 + "a";
  return `${{ toString: () => String(step(55)) }}`.length;
}
function comparisonBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First === 53;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function declaredWithLetBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  let value = Kind.First + Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function statementBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  Kind.First + Kind.Second;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function valueIsReadBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + Kind.Second;
  framesOf.length + value;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function memberOfObjectBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = holder.first + 1;
  return `${{ toString: () => String(step(55)) }}`.length;
}
function callInSumBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + same(1);
  return `${{ toString: () => String(step(55)) }}`.length;
}
function sumInCallBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = same(Kind.First + Kind.Second);
  return `${{ toString: () => String(step(55)) }}`.length;
}
function sumInListBehind() {
  if (framesOf.length > 5) {
    const inner = 1;
  }
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = [Kind.First + Kind.Second, holder.first];
  return `${{ toString: () => String(step(55)) }}`.length;
}
for (const run of [
  lengthMemberFirst,
  numberMemberFirst,
  memberPlusNumberFirst,
  lengthMemberPlusNumberFirst,
  twoMembersFirst,
  memberInBracketsFirst,
  lengthOfTextFirst,
  negatedMemberFirst,
  typeofNumberFirst,
  comparisonFirst,
  declaredWithLetFirst,
  statementFirst,
  valueIsReadFirst,
  memberOfObjectFirst,
  callInSumFirst,
  sumInCallFirst,
  sumInListFirst,
  lengthMemberBehind,
  numberMemberBehind,
  memberPlusNumberBehind,
  lengthMemberPlusNumberBehind,
  twoMembersBehind,
  memberInBracketsBehind,
  lengthOfTextBehind,
  negatedMemberBehind,
  typeofNumberBehind,
  comparisonBehind,
  declaredWithLetBehind,
  statementBehind,
  valueIsReadBehind,
  memberOfObjectBehind,
  callInSumBehind,
  sumInCallBehind,
  sumInListBehind,
]) {
  try {
    run();
  } catch (error) {
    console.log(run.name, framesOf(error));
  }
}
