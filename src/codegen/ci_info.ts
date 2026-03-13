type Vendor = {
  name: string;
  constant: string;
  env: EnvMatch;
  pr?: unknown;
};
type EnvMatch =
  | string
  | EnvMatch[]
  | {
      env: string;
      includes: string;
    }
  | {
      any: string[];
    }
  | Record<string, string>;

// The vendors list is copied from https://github.com/watson/ci-info/blob/master/vendors.json
// The extras list is copied and edited from https://github.com/watson/ci-info/blob/master/index.js line `exports.isCI = !!(...)`
// To update, copy the JSON again.
/*
The MIT License (MIT)

Copyright (c) 2016 Thomas Watson Steen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const extras: string[] = [
  "BUILD_ID", // Jenkins, Cloudbees
  "BUILD_NUMBER", // Jenkins, TeamCity
  "CI", // Travis CI, CircleCI, Cirrus CI, Gitlab CI, Appveyor, CodeShip, dsari, Cloudflare Pages/Workers
  "CI_APP_ID", // Appflow
  "CI_BUILD_ID", // Appflow
  "CI_BUILD_NUMBER", // Appflow
  "CI_NAME", // Codeship and others
  "CONTINUOUS_INTEGRATION", // Travis CI, Cirrus CI
  "RUN_ID", // TaskCluster, dsari
];
const vendors: Vendor[] = [
  {
    "name": "Agola CI",
    "constant": "AGOLA",
    "env": "AGOLA_GIT_REF",
    "pr": "AGOLA_PULL_REQUEST_ID",
  },
  {
    "name": "Appcircle",
    "constant": "APPCIRCLE",
    "env": "AC_APPCIRCLE",
    "pr": {
      "env": "AC_GIT_PR",
      "ne": "false",
    },
  },
  {
    "name": "AppVeyor",
    "constant": "APPVEYOR",
    "env": "APPVEYOR",
    "pr": "APPVEYOR_PULL_REQUEST_NUMBER",
  },
  {
    "name": "AWS CodeBuild",
    "constant": "CODEBUILD",
    "env": "CODEBUILD_BUILD_ARN",
    "pr": {
      "env": "CODEBUILD_WEBHOOK_EVENT",
      "any": ["PULL_REQUEST_CREATED", "PULL_REQUEST_UPDATED", "PULL_REQUEST_REOPENED"],
    },
  },
  {
    "name": "Azure Pipelines",
    "constant": "AZURE_PIPELINES",
    "env": "TF_BUILD",
    "pr": {
      "BUILD_REASON": "PullRequest",
    },
  },
  {
    "name": "Bamboo",
    "constant": "BAMBOO",
    "env": "bamboo_planKey",
  },
  {
    "name": "Bitbucket Pipelines",
    "constant": "BITBUCKET",
    "env": "BITBUCKET_COMMIT",
    "pr": "BITBUCKET_PR_ID",
  },
  {
    "name": "Bitrise",
    "constant": "BITRISE",
    "env": "BITRISE_IO",
    "pr": "BITRISE_PULL_REQUEST",
  },
  {
    "name": "Buddy",
    "constant": "BUDDY",
    "env": "BUDDY_WORKSPACE_ID",
    "pr": "BUDDY_EXECUTION_PULL_REQUEST_ID",
  },
  {
    "name": "Buildkite",
    "constant": "BUILDKITE",
    "env": "BUILDKITE",
    "pr": {
      "env": "BUILDKITE_PULL_REQUEST",
      "ne": "false",
    },
  },
  {
    "name": "CircleCI",
    "constant": "CIRCLE",
    "env": "CIRCLECI",
    "pr": "CIRCLE_PULL_REQUEST",
  },
  {
    "name": "Cirrus CI",
    "constant": "CIRRUS",
    "env": "CIRRUS_CI",
    "pr": "CIRRUS_PR",
  },
  {
    "name": "Cloudflare Pages",
    "constant": "CLOUDFLARE_PAGES",
    "env": "CF_PAGES",
  },
  {
    "name": "Cloudflare Workers",
    "constant": "CLOUDFLARE_WORKERS",
    "env": "WORKERS_CI",
  },
  {
    "name": "Codefresh",
    "constant": "CODEFRESH",
    "env": "CF_BUILD_ID",
    "pr": {
      "any": ["CF_PULL_REQUEST_NUMBER", "CF_PULL_REQUEST_ID"],
    },
  },
  {
    "name": "Codemagic",
    "constant": "CODEMAGIC",
    "env": "CM_BUILD_ID",
    "pr": "CM_PULL_REQUEST",
  },
  {
    "name": "Codeship",
    "constant": "CODESHIP",
    "env": {
      "CI_NAME": "codeship",
    },
  },
  {
    "name": "Drone",
    "constant": "DRONE",
    "env": "DRONE",
    "pr": {
      "DRONE_BUILD_EVENT": "pull_request",
    },
  },
  {
    "name": "dsari",
    "constant": "DSARI",
    "env": "DSARI",
  },
  {
    "name": "Earthly",
    "constant": "EARTHLY",
    "env": "EARTHLY_CI",
  },
  {
    "name": "Expo Application Services",
    "constant": "EAS",
    "env": "EAS_BUILD",
  },
  {
    "name": "Gerrit",
    "constant": "GERRIT",
    "env": "GERRIT_PROJECT",
  },
  {
    "name": "Gitea Actions",
    "constant": "GITEA_ACTIONS",
    "env": "GITEA_ACTIONS",
  },
  {
    "name": "GitHub Actions",
    "constant": "GITHUB_ACTIONS",
    "env": "GITHUB_ACTIONS",
    "pr": {
      "GITHUB_EVENT_NAME": "pull_request",
    },
  },
  {
    "name": "GitLab CI",
    "constant": "GITLAB",
    "env": "GITLAB_CI",
    "pr": "CI_MERGE_REQUEST_ID",
  },
  {
    "name": "GoCD",
    "constant": "GOCD",
    "env": "GO_PIPELINE_LABEL",
  },
  {
    "name": "Google Cloud Build",
    "constant": "GOOGLE_CLOUD_BUILD",
    "env": "BUILDER_OUTPUT",
  },
  {
    "name": "Harness CI",
    "constant": "HARNESS",
    "env": "HARNESS_BUILD_ID",
  },
  {
    "name": "Heroku",
    "constant": "HEROKU",
    "env": {
      "env": "NODE",
      "includes": "/app/.heroku/node/bin/node",
    },
  },
  {
    "name": "Hudson",
    "constant": "HUDSON",
    "env": "HUDSON_URL",
  },
  {
    "name": "Jenkins",
    "constant": "JENKINS",
    "env": ["JENKINS_URL", "BUILD_ID"],
    "pr": {
      "any": ["ghprbPullId", "CHANGE_ID"],
    },
  },
  {
    "name": "LayerCI",
    "constant": "LAYERCI",
    "env": "LAYERCI",
    "pr": "LAYERCI_PULL_REQUEST",
  },
  {
    "name": "Magnum CI",
    "constant": "MAGNUM",
    "env": "MAGNUM",
  },
  {
    "name": "Netlify CI",
    "constant": "NETLIFY",
    "env": "NETLIFY",
    "pr": {
      "env": "PULL_REQUEST",
      "ne": "false",
    },
  },
  {
    "name": "Nevercode",
    "constant": "NEVERCODE",
    "env": "NEVERCODE",
    "pr": {
      "env": "NEVERCODE_PULL_REQUEST",
      "ne": "false",
    },
  },
  {
    "name": "Prow",
    "constant": "PROW",
    "env": "PROW_JOB_ID",
  },
  {
    "name": "ReleaseHub",
    "constant": "RELEASEHUB",
    "env": "RELEASE_BUILD_ID",
  },
  {
    "name": "Render",
    "constant": "RENDER",
    "env": "RENDER",
    "pr": {
      "IS_PULL_REQUEST": "true",
    },
  },
  {
    "name": "Sail CI",
    "constant": "SAIL",
    "env": "SAILCI",
    "pr": "SAIL_PULL_REQUEST_NUMBER",
  },
  {
    "name": "Screwdriver",
    "constant": "SCREWDRIVER",
    "env": "SCREWDRIVER",
    "pr": {
      "env": "SD_PULL_REQUEST",
      "ne": "false",
    },
  },
  {
    "name": "Semaphore",
    "constant": "SEMAPHORE",
    "env": "SEMAPHORE",
    "pr": "PULL_REQUEST_NUMBER",
  },
  {
    "name": "Sourcehut",
    "constant": "SOURCEHUT",
    "env": {
      "CI_NAME": "sourcehut",
    },
  },
  {
    "name": "Strider CD",
    "constant": "STRIDER",
    "env": "STRIDER",
  },
  {
    "name": "TaskCluster",
    "constant": "TASKCLUSTER",
    "env": ["TASK_ID", "RUN_ID"],
  },
  {
    "name": "TeamCity",
    "constant": "TEAMCITY",
    "env": "TEAMCITY_VERSION",
  },
  {
    "name": "Travis CI",
    "constant": "TRAVIS",
    "env": "TRAVIS",
    "pr": {
      "env": "TRAVIS_PULL_REQUEST",
      "ne": "false",
    },
  },
  {
    "name": "Vela",
    "constant": "VELA",
    "env": "VELA",
    "pr": {
      "VELA_PULL_REQUEST": "1",
    },
  },
  {
    "name": "Vercel",
    "constant": "VERCEL",
    "env": {
      "any": ["NOW_BUILDER", "VERCEL"],
    },
    "pr": "VERCEL_GIT_PULL_REQUEST_ID",
  },
  {
    "name": "Visual Studio App Center",
    "constant": "APPCENTER",
    "env": "APPCENTER_BUILD_ID",
  },
  {
    "name": "Woodpecker",
    "constant": "WOODPECKER",
    "env": {
      "CI": "woodpecker",
    },
    "pr": {
      "CI_BUILD_EVENT": "pull_request",
    },
  },
  {
    "name": "Xcode Cloud",
    "constant": "XCODE_CLOUD",
    "env": "CI_XCODE_PROJECT",
    "pr": "CI_PULL_REQUEST_NUMBER",
  },
  {
    "name": "Xcode Server",
    "constant": "XCODE_SERVER",
    "env": "XCS",
  },
];

function genEnvCondition(env: EnvMatch): string {
  if (typeof env === "string") {
    return `bun.getenvZ(${JSON.stringify(env)}) != null`;
  } else if (Array.isArray(env)) {
    return env
      .map(itm => {
        const res = genEnvCondition(itm);
        if (res.includes(" or ")) return `(${res})`;
        return res;
      })
      .join(" and ");
  } else if (typeof env === "object") {
    if ("env" in env) {
      return `bun.strings.containsComptime(bun.getenvZ(${JSON.stringify(env.env)}) orelse "", ${JSON.stringify(env.includes)})`;
    } else if ("any" in env) {
      return (env.any as string[]).map(genEnvCondition).join(" or ");
    } else {
      return Object.entries(env)
        .map(
          ([key, value]) =>
            `bun.strings.eqlComptime(bun.getenvZ(${JSON.stringify(key)}) orelse "", ${JSON.stringify(value)})`,
        )
        .join(" and ");
    }
  } else throw new Error("Not implemented");
}

let codegen: string[] = [];
codegen.push(`/// Generated by src/codegen/ci_info.ts\n`);
codegen.push(`pub fn isCIUncachedGenerated() bool {\n`);
for (const extra of extras) {
  codegen.push(`    if (${genEnvCondition(extra)}) return true;\n`);
}
codegen.push(`    return false;\n`);
codegen.push(`}\n`);
codegen.push(`\n`);
codegen.push(`/// Generated by src/codegen/ci_info.ts\n`);
codegen.push(`pub fn detectUncachedGenerated() ?[]const u8 {\n`);
for (const vendor of vendors) {
  // Names are changed to match what `npm publish` uses
  // https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/workspaces/config/lib/definitions/definitions.js#L2129
  const npm_style_name = vendor.name.toLowerCase().replaceAll(" ", "-");
  codegen.push(`    if (${genEnvCondition(vendor.env)}) return ${JSON.stringify(npm_style_name)};\n`);
}
codegen.push(`    return null;\n`);
codegen.push(`}\n`);
codegen.push(`\n`);
codegen.push(`const bun = @import("bun");\n`);
const result = codegen.join("");

if (import.meta.main) {
  const args = process.argv.slice(2);
  const out = args[0];
  if (out) {
    await Bun.write(out, result);
  } else {
    console.log(result);
  }
}
