// A modified port of ci-info@4.0.0 (https://github.com/watson/ci-info)
// Only gets the CI name, `isPR` is not implemented.
// Table maintained in `ci_info_generated` below

use crate::env_var;

static DETECT_CI_ONCE: crate::Once<Option<&'static [u8]>> =
    <crate::Once<Option<&'static [u8]>>>::new();
static IS_CI_ONCE: crate::Once<bool> = <crate::Once<bool>>::new();

/// returns true if the current process is running in a CI environment
pub fn is_ci() -> bool {
    IS_CI_ONCE.call(is_ci_uncached)
}

/// returns the CI name, or None if the CI name could not be determined. note that this can be None even if `is_ci` is true.
pub fn detect_ci_name() -> Option<&'static [u8]> {
    DETECT_CI_ONCE.call(detect_uncached)
}

fn is_ci_uncached() -> bool {
    env_var::CI
        .get()
        .unwrap_or_else(generated::is_ci_uncached_generated)
        || detect_ci_name().is_some()
}

fn detect_uncached() -> Option<&'static [u8]> {
    if env_var::CI.get() == Some(false) {
        return None;
    }
    generated::detect_uncached_generated()
}

/// CI-provider detection table, copied from watson/ci-info@4.0.0; maintained by
/// hand. Keep in sync with the vendors.json upstream.
mod generated {
    use crate::{getenv_z, zstr};

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

    pub(super) fn is_ci_uncached_generated() -> bool {
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

    pub(super) fn detect_uncached_generated() -> Option<&'static [u8]> {
        if env_set!("AGOLA_GIT_REF") {
            return Some(b"agola-ci");
        }
        if env_set!("AC_APPCIRCLE") {
            return Some(b"appcircle");
        }
        if env_set!("APPVEYOR") {
            return Some(b"appveyor");
        }
        if env_set!("CODEBUILD_BUILD_ARN") {
            return Some(b"aws-codebuild");
        }
        if env_set!("TF_BUILD") {
            return Some(b"azure-pipelines");
        }
        if env_set!("bamboo_planKey") {
            return Some(b"bamboo");
        }
        if env_set!("BITBUCKET_COMMIT") {
            return Some(b"bitbucket-pipelines");
        }
        if env_set!("BITRISE_IO") {
            return Some(b"bitrise");
        }
        if env_set!("BUDDY_WORKSPACE_ID") {
            return Some(b"buddy");
        }
        if env_set!("BUILDKITE") {
            return Some(b"buildkite");
        }
        if env_set!("CIRCLECI") {
            return Some(b"circleci");
        }
        if env_set!("CIRRUS_CI") {
            return Some(b"cirrus-ci");
        }
        if env_set!("CF_PAGES") {
            return Some(b"cloudflare-pages");
        }
        if env_set!("WORKERS_CI") {
            return Some(b"cloudflare-workers");
        }
        if env_set!("CF_BUILD_ID") {
            return Some(b"codefresh");
        }
        if env_set!("CM_BUILD_ID") {
            return Some(b"codemagic");
        }
        if env_eq!("CI_NAME", "codeship") {
            return Some(b"codeship");
        }
        if env_set!("DRONE") {
            return Some(b"drone");
        }
        if env_set!("DSARI") {
            return Some(b"dsari");
        }
        if env_set!("EARTHLY_CI") {
            return Some(b"earthly");
        }
        if env_set!("EAS_BUILD") {
            return Some(b"expo-application-services");
        }
        if env_set!("GERRIT_PROJECT") {
            return Some(b"gerrit");
        }
        if env_set!("GITEA_ACTIONS") {
            return Some(b"gitea-actions");
        }
        if env_set!("GITHUB_ACTIONS") {
            return Some(b"github-actions");
        }
        if env_set!("GITLAB_CI") {
            return Some(b"gitlab-ci");
        }
        if env_set!("GO_PIPELINE_LABEL") {
            return Some(b"gocd");
        }
        if env_set!("BUILDER_OUTPUT") {
            return Some(b"google-cloud-build");
        }
        if env_set!("HARNESS_BUILD_ID") {
            return Some(b"harness-ci");
        }
        if env_contains!("NODE", "/app/.heroku/node/bin/node") {
            return Some(b"heroku");
        }
        if env_set!("HUDSON_URL") {
            return Some(b"hudson");
        }
        if env_set!("JENKINS_URL") && env_set!("BUILD_ID") {
            return Some(b"jenkins");
        }
        if env_set!("LAYERCI") {
            return Some(b"layerci");
        }
        if env_set!("MAGNUM") {
            return Some(b"magnum-ci");
        }
        if env_set!("NETLIFY") {
            return Some(b"netlify-ci");
        }
        if env_set!("NEVERCODE") {
            return Some(b"nevercode");
        }
        if env_set!("PROW_JOB_ID") {
            return Some(b"prow");
        }
        if env_set!("RELEASE_BUILD_ID") {
            return Some(b"releasehub");
        }
        if env_set!("RENDER") {
            return Some(b"render");
        }
        if env_set!("SAILCI") {
            return Some(b"sail-ci");
        }
        if env_set!("SCREWDRIVER") {
            return Some(b"screwdriver");
        }
        if env_set!("SEMAPHORE") {
            return Some(b"semaphore");
        }
        if env_eq!("CI_NAME", "sourcehut") {
            return Some(b"sourcehut");
        }
        if env_set!("STRIDER") {
            return Some(b"strider-cd");
        }
        if env_set!("TASK_ID") && env_set!("RUN_ID") {
            return Some(b"taskcluster");
        }
        if env_set!("TEAMCITY_VERSION") {
            return Some(b"teamcity");
        }
        if env_set!("TRAVIS") {
            return Some(b"travis-ci");
        }
        if env_set!("VELA") {
            return Some(b"vela");
        }
        if env_set!("NOW_BUILDER") || env_set!("VERCEL") {
            return Some(b"vercel");
        }
        if env_set!("APPCENTER_BUILD_ID") {
            return Some(b"visual-studio-app-center");
        }
        if env_eq!("CI", "woodpecker") {
            return Some(b"woodpecker");
        }
        if env_set!("CI_XCODE_PROJECT") {
            return Some(b"xcode-cloud");
        }
        if env_set!("XCS") {
            return Some(b"xcode-server");
        }
        None
    }
}
