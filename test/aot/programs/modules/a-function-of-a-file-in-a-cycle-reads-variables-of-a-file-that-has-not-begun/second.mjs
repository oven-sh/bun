import { readFraction, readLet, readStatic, readVar } from "./first.mjs";
for (const read of [readVar, readFraction, readLet, readStatic]) {
  try {
    console.log("second", String(read()));
  } catch (error) {
    console.log("second", error.name);
  }
}
