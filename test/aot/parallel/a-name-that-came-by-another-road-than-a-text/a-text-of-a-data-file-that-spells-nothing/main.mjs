// The texts of this data file spell no such name: nothing more is brought.
// STATISTIC: FunctionsLowered <= 60
import words from "./words.json";
const held = words;
const pick = (holder, key) => Reflect.get(holder, key);
