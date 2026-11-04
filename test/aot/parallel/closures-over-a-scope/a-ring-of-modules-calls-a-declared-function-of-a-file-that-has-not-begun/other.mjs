import { read } from "./main.mjs";
export let said;
try {
  said = read();
} catch (error) {
  said = "throws " + error.name;
}
