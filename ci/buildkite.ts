#!/usr/bin/env node --include=tsx

// TODO: Install @types/node, check on status of running typescript on CI
// @ts-ignore
import { writeFileSync, mkdirSync } from "node:fs";
// @ts-ignore
import { join, dirname } from "node:path";
import { PipelineOptionsBuilder } from "./cd/pipeline/Pipeline.Options.Builder";
import { BuildkiteBuild } from "./cd/pipeline/buildkite/Buildkite.Build._";
import { BuildkitePipeline } from "./cd/pipeline/buildkite/Buildkite.Pipeline._";
import { uploadArtifact } from "./machine/Artifact";
import { printEnvironment, spawnSafe } from "./machine/context/Process";
import { getCanaryRevision, isBuildkite } from "./machine/executor/Buildkite";
import { toYaml } from "./machine/format/Yaml";
import { SpawnOptions } from "../scripts/utils.mjs";
import { generateBuildkitePipeline } from "./codegen/Codegen.Buildkite.Pipeline";

async function writeBuildkitePipelineYaml({
  options,
  contentPath,
}: {
  options: PipelineOptionsBuilder<BuildkiteBuild>;
  contentPath: string;
}) {
  printEnvironment();

  const content = toYaml(generateBuildkitePipeline(options.build()));
  console.dir({
    Pipeline: {
      message: "Generated pipeline",
      path: contentPath,
      size: (content.length / 1024).toFixed() + "KB",
    },
  });

  try {
    mkdirSync(dirname(contentPath), { recursive: true });
  } catch (_) {}
  writeFileSync(contentPath, content);

  return options;
}

async function uploadBuildkitePipelineToAgent({
  contentPath,
  buildRelease,
}: {
  contentPath: string;
  buildRelease: boolean;
}) {
  console.log("Uploading artifact...");
  await uploadArtifact(contentPath);

  console.log("Setting canary revision...");
  const canaryRevision = buildRelease ? 0 : await getCanaryRevision();
  await spawnSafe(["buildkite-agent", "meta-data", "set", "canary", `${canaryRevision}`], {
    stdio: "inherit",
  } as SpawnOptions);

  console.log("Uploading pipeline...");
  await spawnSafe(["buildkite-agent", "pipeline", "upload", contentPath], { stdio: "inherit" } as SpawnOptions);
}

async function main() {
  const contentPath = join(process.cwd(), ".buildkite", "ci.yml");
  const { buildRelease } = await writeBuildkitePipelineYaml({
    options: await PipelineOptionsBuilder.for<BuildkiteBuild>(
      BuildkitePipeline.lastBuild,
      BuildkitePipeline.changedFiles,
      BuildkitePipeline.buildRelease,
    ),
    contentPath,
  });

  if (isBuildkite) {
    await uploadBuildkitePipelineToAgent({ contentPath, buildRelease: buildRelease });
  } else {
    console.log("Not running in Buildkite, skipping pipeline upload.");
  }
}
await main();
