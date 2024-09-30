// A modified port of ci-info@4.0.0 (https://github.com/watson/ci-info)
// Only gets the CI name, `isPR` is not implemented.

// Names are changed to match what `npm publish` uses
// https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/workspaces/config/lib/definitions/definitions.js#L2129
// `name.toLowerCase().split(' ').join('-')`

const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;

var ci_name: ?[]const u8 = null;

pub fn detectCI() ?[]const u8 {
    const ci = ci_name orelse ci_name: {
        CI.once.call();
        break :ci_name ci_name.?;
    };

    return if (ci.len == 0) null else ci;
}

const CI = enum {
    @"agola-ci",
    appcircle,
    appveyor,
    @"aws-codebuild",
    @"azure-pipelines",
    bamboo,
    @"bitbucket-pipelines",
    bitrise,
    buddy,
    buildkite,
    circleci,
    @"cirrus-ci",
    codefresh,
    codemagic,
    codeship,
    drone,
    dsari,
    earthly,
    @"expo-application-services",
    gerrit,
    @"gitea-actions",
    @"github-actions",
    @"gitlab-ci",
    gocd,
    @"google-cloud-build",
    @"harness-ci",
    // heroku,
    hudson,
    jenkins,
    layerci,
    @"magnum-ci",
    @"netlify-ci",
    nevercode,
    prow,
    releasehub,
    render,
    @"sail-ci",
    screwdriver,
    semaphore,
    sourcehut,
    @"strider-cd",
    taskcluster,
    teamcity,
    @"travis-ci",
    vela,
    vercel,
    @"visual-studio-app-center",
    woodpecker,
    @"xcode-cloud",
    @"xcode-server",

    pub var once = std.once(struct {
        pub fn once() void {
            var name: []const u8 = "";
            defer ci_name = name;

            if (bun.getenvZ("CI")) |ci| {
                if (strings.eqlComptime(ci, "false")) {
                    return;
                }
            }

            // Special case Heroku
            if (bun.getenvZ("NODE")) |node| {
                if (strings.containsComptime(node, "/app/.heroku/node/bin/node")) {
                    name = "heroku";
                    return;
                }
            }

            ci: for (CI.array.values, 0..) |item, i| {
                const any, const pairs = item;

                pairs: for (pairs) |pair| {
                    const key, const value = pair;

                    if (bun.getenvZ(key)) |env| {
                        if (value.len == 0 or bun.strings.eqlLong(env, value, true)) {
                            if (!any) continue :pairs;

                            name = @tagName(Array.Indexer.keyForIndex(i));
                            return;
                        }
                    }

                    if (!any) continue :ci;
                }

                if (!any) {
                    name = @tagName(Array.Indexer.keyForIndex(i));
                    return;
                }
            }
        }
    }.once);

    pub const Array = std.EnumArray(CI, struct { bool, []const [2][:0]const u8 });

    pub const array = Array.init(.{
        .@"agola-ci" = .{
            false,
            &.{
                .{ "AGOLA_GIT_REF", "" },
            },
        },
        .appcircle = .{
            false,
            &.{
                .{ "AC_APPCIRCLE", "" },
            },
        },
        .appveyor = .{
            false,
            &.{
                .{ "APPVEYOR", "" },
            },
        },
        .@"aws-codebuild" = .{
            false,
            &.{
                .{ "CODEBUILD_BUILD_ARN", "" },
            },
        },
        .@"azure-pipelines" = .{
            false,
            &.{
                .{ "TF_BUILD", "" },
            },
        },
        .bamboo = .{
            false,
            &.{
                .{ "bamboo_planKey", "" },
            },
        },
        .@"bitbucket-pipelines" = .{
            false,
            &.{
                .{ "BITBUCKET_COMMIT", "" },
            },
        },
        .bitrise = .{
            false,
            &.{
                .{ "BITRISE_IO", "" },
            },
        },
        .buddy = .{
            false,
            &.{
                .{ "BUDDY_WORKSPACE_ID", "" },
            },
        },
        .buildkite = .{
            false,
            &.{
                .{ "BUILDKITE", "" },
            },
        },
        .circleci = .{
            false,
            &.{
                .{ "CIRCLECI", "" },
            },
        },
        .@"cirrus-ci" = .{
            false,
            &.{
                .{ "CIRRUS_CI", "" },
            },
        },
        .codefresh = .{
            false,
            &.{
                .{ "CF_BUILD_ID", "" },
            },
        },
        .codemagic = .{
            false,
            &.{
                .{ "CM_BUILD_ID", "" },
            },
        },
        .codeship = .{
            false,
            &.{
                .{ "CI_NAME", "codeship" },
            },
        },
        .drone = .{
            false,
            &.{
                .{ "DRONE", "" },
            },
        },
        .dsari = .{
            false,
            &.{
                .{ "DSARI", "" },
            },
        },
        .earthly = .{
            false,
            &.{
                .{ "EARTHLY_CI", "" },
            },
        },
        .@"expo-application-services" = .{
            false,
            &.{
                .{ "EAS_BUILD", "" },
            },
        },
        .gerrit = .{
            false,
            &.{
                .{ "GERRIT_PROJECT", "" },
            },
        },
        .@"gitea-actions" = .{
            false,
            &.{
                .{ "GITEA_ACTIONS", "" },
            },
        },
        .@"github-actions" = .{
            false,
            &.{
                .{ "GITHUB_ACTIONS", "" },
            },
        },
        .@"gitlab-ci" = .{
            false,
            &.{
                .{ "GITLAB_CI", "" },
            },
        },
        .gocd = .{
            false,
            &.{
                .{ "GO_PIPELINE_LABEL", "" },
            },
        },
        .@"google-cloud-build" = .{
            false,
            &.{
                .{ "BUILDER_OUTPUT", "" },
            },
        },
        .@"harness-ci" = .{
            false,
            &.{
                .{ "HARNESS_BUILD_ID", "" },
            },
        },
        .hudson = .{
            false,
            &.{
                .{ "HUDSON_URL", "" },
            },
        },
        .jenkins = .{
            false,
            &.{
                .{ "JENKINS_URL", "" },
                .{ "BUILD_ID", "" },
            },
        },
        .layerci = .{
            false,
            &.{
                .{ "LAYERCI", "" },
            },
        },
        .@"magnum-ci" = .{
            false,
            &.{
                .{ "MAGNUM", "" },
            },
        },
        .@"netlify-ci" = .{
            false,
            &.{
                .{ "NETLIFY", "" },
            },
        },
        .nevercode = .{
            false,
            &.{
                .{ "NEVERCODE", "" },
            },
        },
        .prow = .{
            false,
            &.{
                .{ "PROW_JOB_ID", "" },
            },
        },
        .releasehub = .{
            false,
            &.{
                .{ "RELEASE_BUILD_ID", "" },
            },
        },
        .render = .{
            false,
            &.{
                .{ "RENDER", "" },
            },
        },
        .@"sail-ci" = .{
            false,
            &.{
                .{ "SAILCI", "" },
            },
        },
        .screwdriver = .{
            false,
            &.{
                .{ "SCREWDRIVER", "" },
            },
        },
        .semaphore = .{
            false,
            &.{
                .{ "SEMAPHORE", "" },
            },
        },
        .sourcehut = .{
            false,
            &.{
                .{ "CI_NAME", "sourcehut" },
            },
        },
        .@"strider-cd" = .{
            false,
            &.{
                .{ "STRIDER", "" },
            },
        },
        .taskcluster = .{
            false,
            &.{
                .{ "TASK_ID", "" },
                .{ "RUN_ID", "" },
            },
        },
        .teamcity = .{
            false,
            &.{
                .{ "TEAMCITY_VERSION", "" },
            },
        },
        .@"travis-ci" = .{
            false,
            &.{
                .{ "TRAVIS", "" },
            },
        },
        .vela = .{
            false,
            &.{
                .{ "VELA", "" },
            },
        },
        .vercel = .{
            true,
            &.{
                .{ "NOW_BUILDER", "" },
                .{ "VERCEL", "" },
            },
        },
        .@"visual-studio-app-center" = .{
            false,
            &.{
                .{ "APPCENTER_BUILD_ID", "" },
            },
        },
        .woodpecker = .{
            false,
            &.{
                .{ "CI", "woodpecker" },
            },
        },
        .@"xcode-cloud" = .{
            false,
            &.{
                .{ "CI_XCODE_PROJECT", "" },
            },
        },
        .@"xcode-server" = .{
            false,
            &.{
                .{ "XCS", "" },
            },
        },
    });
};
