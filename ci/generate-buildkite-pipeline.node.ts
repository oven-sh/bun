#!/usr/bin/env node --experimental-strip-types

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PipelineOptionsBuilder } from "./cd/pipeline/PipelineOptionsBuilder.ts";
import { BuildkitePipeline, type BuildkiteBuild } from "./cd/pipeline/buildkite/BuildkitePipeline.ts";
import { type SpawnOptions } from "./cd/runner/Spawn.ts";
import { generateBuildkitePipeline } from "./codegen/buildkite-pipeline.ts";
import { uploadArtifact } from "./machine/artifact.ts";
import { printEnvironment, spawnSafe } from "./machine/context/process.ts";
import { getCanaryRevision, isBuildkite } from "./machine/executor/buildkite.ts";
import { toYaml } from "./machine/format/yaml.ts";

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
