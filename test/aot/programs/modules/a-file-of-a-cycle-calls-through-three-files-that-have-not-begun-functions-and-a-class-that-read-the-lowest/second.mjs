import { viaThird, viaClass } from "./first.mjs";
for (const read of [viaThird, viaClass]) {
  try {
    console.log("second", JSON.stringify(read()));
  } catch (error) {
    console.log("second", error.name);
  }
}
