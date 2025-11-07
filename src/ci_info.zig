// A modified port of ci-info@4.0.0 (https://github.com/watson/ci-info)
// Only gets the CI name, `isPR` is not implemented.

// Names are changed to match what `npm publish` uses
// https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/workspaces/config/lib/definitions/definitions.js#L2129
// `name.toLowerCase().split(' ').join('-')`

var once = bun.once(detectUncached);
pub fn detectCI() ?[]const u8 {
    return once.call(.{});
}

fn detectUncached() ?[]const u8 {
    if (bun.env_var.CI.get() == false) return null;

    if (bun.getenvZ("AGOLA_GIT_REF") != null) return "agola-ci";
    if (bun.getenvZ("AC_APPCIRCLE") != null) return "appcircle";
    if (bun.getenvZ("APPVEYOR") != null) return "appveyor";
    if (bun.getenvZ("CODEBUILD_BUILD_ARN") != null) return "aws-codebuild";
    if (bun.getenvZ("TF_BUILD") != null) return "azure-pipelines";
    if (bun.getenvZ("bamboo_planKey") != null) return "bamboo";
    if (bun.getenvZ("BITBUCKET_COMMIT") != null) return "bitbucket-pipelines";
    if (bun.getenvZ("BITRISE_IO") != null) return "bitrise";
    if (bun.getenvZ("BUDDY_WORKSPACE_ID") != null) return "buddy";
    if (bun.getenvZ("BUILDKITE") != null) return "buildkite";
    if (bun.getenvZ("CIRCLECI") != null) return "circleci";
    if (bun.getenvZ("CIRRUS_CI") != null) return "cirrus-ci";
    if (bun.getenvZ("CF_BUILD_ID") != null) return "codefresh";
    if (bun.getenvZ("CM_BUILD_ID") != null) return "codemagic";
    if (bun.getenvZ("CI_NAME")) |val| if (bun.strings.eqlComptime(val, "codeship")) return "codeship";
    if (bun.getenvZ("DRONE") != null) return "drone";
    if (bun.getenvZ("DSARI") != null) return "dsari";
    if (bun.getenvZ("EARTHLY_CI") != null) return "earthly";
    if (bun.getenvZ("EAS_BUILD") != null) return "expo-application-services";
    if (bun.getenvZ("GERRIT_PROJECT") != null) return "gerrit";
    if (bun.getenvZ("GITEA_ACTIONS") != null) return "gitea-actions";
    if (bun.getenvZ("GITHUB_ACTIONS") != null) return "github-actions";
    if (bun.getenvZ("GITLAB_CI") != null) return "gitlab-ci";
    if (bun.getenvZ("GO_PIPELINE_LABEL") != null) return "gocd";
    if (bun.getenvZ("BUILDER_OUTPUT") != null) return "google-cloud-build";
    if (bun.getenvZ("HARNESS_BUILD_ID") != null) return "harness-ci";
    if (bun.getenvZ("HUDSON_URL") != null) return "hudson";
    if (bun.getenvZ("JENKINS_URL") != null and bun.getenvZ("BUILD_ID") != null) return "jenkins";
    if (bun.getenvZ("LAYERCI") != null) return "layerci";
    if (bun.getenvZ("MAGNUM") != null) return "magnum-ci";
    if (bun.getenvZ("NETLIFY") != null) return "netlify-ci";
    if (bun.getenvZ("NEVERCODE") != null) return "nevercode";
    if (bun.getenvZ("PROW_JOB_ID") != null) return "prow";
    if (bun.getenvZ("RELEASE_BUILD_ID") != null) return "releasehub";
    if (bun.getenvZ("RENDER") != null) return "render";
    if (bun.getenvZ("SAILCI") != null) return "sail-ci";
    if (bun.getenvZ("SCREWDRIVER") != null) return "screwdriver";
    if (bun.getenvZ("SEMAPHORE") != null) return "semaphore";
    if (bun.getenvZ("CI_NAME")) |val| if (bun.strings.eqlComptime(val, "sourcehut")) return "sourcehut";
    if (bun.getenvZ("STRIDER") != null) return "strider-cd";
    if (bun.getenvZ("TASK_ID") != null and bun.getenvZ("RUN_ID") != null) return "taskcluster";
    if (bun.getenvZ("TEAMCITY_VERSION") != null) return "teamcity";
    if (bun.getenvZ("TRAVIS") != null) return "travis-ci";
    if (bun.getenvZ("VELA") != null) return "vela";
    if (bun.getenvZ("NODE")) |node| if (strings.containsComptime(node, "/app/.heroku/node/bin/node")) return "heroku";
    if (bun.getenvZ("NOW_BUILDER") != null or bun.getenvZ("VERCEL") != null) return "vercel";
    if (bun.getenvZ("APPCENTER_BUILD_ID") != null) return "visual-studio-app-center";
    if (bun.getenvZ("CI")) |val| if (bun.strings.eqlComptime(val, "woodpecker")) return "woodpecker";
    if (bun.getenvZ("CI_XCODE_PROJECT") != null) return "xcode-cloud";
    if (bun.getenvZ("XCS") != null) return "xcode-server";
    if (bun.getenvZ("XCS") != null) return "xcode-server";

    if (bun.env_var.CI.get() == true) return "unknown";
    return null;
}

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
