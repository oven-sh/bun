// Compares the layout of bun's bindings in the portable image with what the headers say.
//
//   bun compare.ts <image.json> <headers.json>
//
// <image.json> is the output of `bun_fs_slice.img --layout`, <headers.json> the one of verify.ts on
// Windows. Prints every difference and what could not be compared, and fails if there is a difference.
import { readFileSync } from "node:fs";

type Facts = {
  types: Record<
    string,
    { partial?: boolean; size: number; align: number; fields: Record<string, { offset: number; size: number | null }> }
  >;
  constants: Record<string, string>;
  system?: string;
  left_out?: { types: string[]; fields: string[]; constants: string[] };
};
const [imagePath, headersPath] = process.argv.slice(2);
if (!imagePath || !headersPath) throw new Error("usage: bun compare.ts <image.json> <headers.json>");
const image: Facts = JSON.parse(readFileSync(imagePath, "utf8"));
const headers: Facts = JSON.parse(readFileSync(headersPath, "utf8"));

const differences: string[] = [];
const notCompared: string[] = [];
const partial: string[] = [];
let same = 0;
for (const [name, ours] of Object.entries(image.types)) {
  const theirs = headers.types[name];
  if (!theirs) {
    notCompared.push(`type ${name}: not in the headers`);
    continue;
  }
  if (ours.partial) {
    // The binding has the first fields of the structure: every one of them is compared below, and the
    // structure of the headers has to hold them.
    if (ours.size > theirs.size)
      differences.push(
        `type ${name}: the binding is a view of ${ours.size} bytes, the structure of the headers has ${theirs.size}`,
      );
    else partial.push(`type ${name}: ${ours.size} of ${theirs.size} bytes`);
  } else {
    if (ours.size !== theirs.size)
      differences.push(`type ${name}: size ${ours.size} in the image, ${theirs.size} in the headers`);
    else same++;
    if (ours.align !== theirs.align)
      differences.push(`type ${name}: alignment ${ours.align} in the image, ${theirs.align} in the headers`);
    else same++;
  }
  for (const [field, ourField] of Object.entries(ours.fields)) {
    const theirField = theirs.fields[field];
    if (!theirField) {
      notCompared.push(`field ${name}.${field}: not in the headers`);
      continue;
    }
    if (ourField.offset !== theirField.offset)
      differences.push(
        `field ${name}.${field}: offset ${ourField.offset} in the image, ${theirField.offset} in the headers`,
      );
    else same++;
    if (ourField.size === null) notCompared.push(`field ${name}.${field}: its size, the structure is packed`);
    else if (ourField.size !== theirField.size)
      differences.push(`field ${name}.${field}: size ${ourField.size} in the image, ${theirField.size} in the headers`);
    else same++;
  }
}
for (const [name, ours] of Object.entries(image.constants)) {
  const theirs = headers.constants[name];
  if (theirs === undefined) {
    notCompared.push(`constant ${name}: not in the headers`);
    continue;
  }
  // The headers may give a constant another signedness or width than the binding: the same bits of
  // the narrower of 32 and 64 bits are the same constant.
  const equal =
    BigInt(ours) === BigInt(theirs) ||
    (BigInt.asUintN(32, BigInt(ours)) === BigInt.asUintN(32, BigInt(theirs)) &&
      BigInt.asIntN(32, BigInt(ours)) === BigInt(ours)) ||
    BigInt.asUintN(64, BigInt(ours)) === BigInt.asUintN(64, BigInt(theirs));
  if (!equal) differences.push(`constant ${name}: ${ours} in the image, ${theirs} in the headers`);
  else same++;
}
if (headers.system && headers.system !== "win32")
  console.log(
    `NOTE: the headers are the ones of ${headers.system}, not of Windows: this comparison checks the tools only`,
  );
for (const line of notCompared) console.log(`not compared  ${line}`);
for (const line of partial) console.log(`partial view  ${line}`);
for (const line of differences) console.log(`DIFFERENT     ${line}`);
console.log(`${same} facts are the same, ${differences.length} differ, ${notCompared.length} could not be compared`);
process.exit(differences.length ? 1 : 0);
