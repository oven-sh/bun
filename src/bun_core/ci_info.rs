//! CI detection, a port of ci-info@4.0.0 (https://github.com/watson/ci-info) without `isPR`.

use crate::env_var;
use crate::{Once, getenv_z, zstr};

static DETECT_CI_ONCE: Once<Option<&'static [u8]>> = <Once<Option<&'static [u8]>>>::new();
static IS_CI_ONCE: Once<bool> = <Once<bool>>::new();

/// returns true if the current process is running in a CI environment
pub fn is_ci() -> bool {
    IS_CI_ONCE.call(is_ci_uncached)
}

/// returns the CI name, or None if the CI name could not be determined. note that this can be None even if `is_ci` is true.
pub fn detect_ci_name() -> Option<&'static [u8]> {
    DETECT_CI_ONCE.call(detect_uncached)
}

fn is_ci_uncached() -> bool {
    env_var::CI.get().unwrap_or_else(is_ci_uncached_generated) || detect_ci_name().is_some()
}

fn detect_uncached() -> Option<&'static [u8]> {
    if env_var::CI.get() == Some(false) {
        return None;
    }
    detect_uncached_generated()
}

// Vendor table, copied by hand from ci-info@4.0.0 vendors.json.

macro_rules! env_set {
    ($k:literal) => {
        getenv_z(zstr!($k)).is_some()
    };
}
macro_rules! env_eq {
    ($k:literal, $v:literal) => {
        getenv_z(zstr!($k)).map_or(false, |v| v == $v.as_bytes())
    };
}
macro_rules! env_contains {
    ($k:literal, $needle:literal) => {
        getenv_z(zstr!($k)).map_or(false, |v| {
            crate::strings::index_of(v, $needle.as_bytes()).is_some()
        })
    };
}

fn is_ci_uncached_generated() -> bool {
    env_set!("BUILD_ID")
        || env_set!("BUILD_NUMBER")
        || env_set!("CI")
        || env_set!("CI_APP_ID")
        || env_set!("CI_BUILD_ID")
        || env_set!("CI_BUILD_NUMBER")
        || env_set!("CI_NAME")
        || env_set!("CONTINUOUS_INTEGRATION")
        || env_set!("RUN_ID")
}

fn detect_uncached_generated() -> Option<&'static [u8]> {
    // The first match names the CI.
    macro_rules! vendors {
        ($($name:literal: $detected:expr,)*) => {
            $(if $detected {
                return Some($name);
            })*
        };
    }
    vendors! {
        b"agola-ci": env_set!("AGOLA_GIT_REF"),
        b"appcircle": env_set!("AC_APPCIRCLE"),
        b"appveyor": env_set!("APPVEYOR"),
        b"aws-codebuild": env_set!("CODEBUILD_BUILD_ARN"),
        b"azure-pipelines": env_set!("TF_BUILD"),
        b"bamboo": env_set!("bamboo_planKey"),
        b"bitbucket-pipelines": env_set!("BITBUCKET_COMMIT"),
        b"bitrise": env_set!("BITRISE_IO"),
        b"buddy": env_set!("BUDDY_WORKSPACE_ID"),
        b"buildkite": env_set!("BUILDKITE"),
        b"circleci": env_set!("CIRCLECI"),
        b"cirrus-ci": env_set!("CIRRUS_CI"),
        b"cloudflare-pages": env_set!("CF_PAGES"),
        b"cloudflare-workers": env_set!("WORKERS_CI"),
        b"codefresh": env_set!("CF_BUILD_ID"),
        b"codemagic": env_set!("CM_BUILD_ID"),
        b"codeship": env_eq!("CI_NAME", "codeship"),
        b"drone": env_set!("DRONE"),
        b"dsari": env_set!("DSARI"),
        b"earthly": env_set!("EARTHLY_CI"),
        b"expo-application-services": env_set!("EAS_BUILD"),
        b"gerrit": env_set!("GERRIT_PROJECT"),
        b"gitea-actions": env_set!("GITEA_ACTIONS"),
        b"github-actions": env_set!("GITHUB_ACTIONS"),
        b"gitlab-ci": env_set!("GITLAB_CI"),
        b"gocd": env_set!("GO_PIPELINE_LABEL"),
        b"google-cloud-build": env_set!("BUILDER_OUTPUT"),
        b"harness-ci": env_set!("HARNESS_BUILD_ID"),
        b"heroku": env_contains!("NODE", "/app/.heroku/node/bin/node"),
        b"hudson": env_set!("HUDSON_URL"),
        b"jenkins": env_set!("JENKINS_URL") && env_set!("BUILD_ID"),
        b"layerci": env_set!("LAYERCI"),
        b"magnum-ci": env_set!("MAGNUM"),
        b"netlify-ci": env_set!("NETLIFY"),
        b"nevercode": env_set!("NEVERCODE"),
        b"prow": env_set!("PROW_JOB_ID"),
        b"releasehub": env_set!("RELEASE_BUILD_ID"),
        b"render": env_set!("RENDER"),
        b"sail-ci": env_set!("SAILCI"),
        b"screwdriver": env_set!("SCREWDRIVER"),
        b"semaphore": env_set!("SEMAPHORE"),
        b"sourcehut": env_eq!("CI_NAME", "sourcehut"),
        b"strider-cd": env_set!("STRIDER"),
        b"taskcluster": env_set!("TASK_ID") && env_set!("RUN_ID"),
        b"teamcity": env_set!("TEAMCITY_VERSION"),
        b"travis-ci": env_set!("TRAVIS"),
        b"vela": env_set!("VELA"),
        b"vercel": env_set!("NOW_BUILDER") || env_set!("VERCEL"),
        b"visual-studio-app-center": env_set!("APPCENTER_BUILD_ID"),
        b"woodpecker": env_eq!("CI", "woodpecker"),
        b"xcode-cloud": env_set!("CI_XCODE_PROJECT"),
        b"xcode-server": env_set!("XCS"),
    }
    None
}
