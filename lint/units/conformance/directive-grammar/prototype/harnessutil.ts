import { toLower } from "./go_strings";
import { getBaseFileName } from "./tspath";

// Port of GetConfigNameFromFileName in internal/testutil/harnessutil/harnessutil.go.
export function getConfigNameFromFileName(filename: string): string {
  const basenameLower = toLower(getBaseFileName(filename));
  if (basenameLower === "tsconfig.json" || basenameLower === "jsconfig.json") {
    return basenameLower;
  }
  return "";
}
