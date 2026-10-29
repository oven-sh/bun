import { readFourth, readThird } from "./first.mjs";
for (const read of [readThird, readFourth]) {
  try {
    console.log("second", JSON.stringify(read()));
  } catch (error) {
    console.log("second", error.name);
  }
}
