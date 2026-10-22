import { measureTrimProfile } from "bun:internal-for-testing";
import { readFeatureModel } from "./features.ts";
import type { ProfileMeasurement } from "./types.ts";

const [executable, featuresPath] = process.argv.slice(2) as [string, string];
const measurements: ProfileMeasurement[] = readFeatureModel(featuresPath).profiles.map(({ name, features }) => ({
  profile: name,
  ...measureTrimProfile(executable, features),
}));
console.log(JSON.stringify(measurements));
