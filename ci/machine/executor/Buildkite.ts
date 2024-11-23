import { getLastSuccessfulBuild as getLastSuccessfulBuild_ } from "../../../scripts/utils.mjs";
import { getCanaryRevision as getCanaryRevision_ } from "../../../scripts/utils.mjs";
import { BuildkiteBuild } from "../../cd/pipeline/buildkite/Buildkite.Build._";

let __lastSuccessfulBuild: BuildkiteBuild | undefined;
export const getLastSuccessfulBuild: () => Promise<BuildkiteBuild | undefined> = async () => {
  if (__lastSuccessfulBuild === undefined) {
    __lastSuccessfulBuild = await getLastSuccessfulBuild_();
  }
  return __lastSuccessfulBuild;
};

let __canaryRevision: number | undefined;
export const getCanaryRevision: () => Promise<number> = async () => {
  if (__canaryRevision === undefined) {
    __canaryRevision = await getCanaryRevision_();
  }
  return __canaryRevision!;
};

export { isBuildkite } from "../../../scripts/utils.mjs";
