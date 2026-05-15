//! SLSA provenance statement generation, ported from
//! `libnpmpublish/lib/provenance.js` (npm CLI, ISC).
//!
//! Emits an in-toto statement JSON with a single `subject` (the package
//! tarball, identified by purl + sha512) and a provider-specific predicate:
//!   - GitHub Actions → in-toto v1 / SLSA v1 (buildDefinition/runDetails);
//!   - GitLab CI      → in-toto v0.1 / SLSA v0.2 (invocation/materials).

use serde_json::{Value, json};

use crate::CiProvider;

const INTOTO_STATEMENT_V1_TYPE: &str = "https://in-toto.io/Statement/v1";
const INTOTO_STATEMENT_V01_TYPE: &str = "https://in-toto.io/Statement/v0.1";
const SLSA_PREDICATE_V1_TYPE: &str = "https://slsa.dev/provenance/v1";
const SLSA_PREDICATE_V02_TYPE: &str = "https://slsa.dev/provenance/v0.2";

const GITHUB_BUILDER_ID_PREFIX: &str = "https://github.com/actions/runner";
const GITHUB_BUILD_TYPE: &str =
    "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";

const GITLAB_BUILD_TYPE_PREFIX: &str = "https://github.com/npm/cli/gitlab";
const GITLAB_BUILD_TYPE_VERSION: &str = "v0alpha1";

/// npm-style package URL: `pkg:npm/<name>@<version>`, with `@scope/`
/// URL-encoded to `%40scope/` (matching `npm-package-arg` `toPurl`).
pub fn to_purl(name: &[u8], version: &[u8]) -> String {
    let mut s = String::with_capacity(10 + name.len() + version.len());
    s.push_str("pkg:npm/");
    if let Some(stripped) = name.strip_prefix(b"@") {
        s.push_str("%40");
        s.push_str(&String::from_utf8_lossy(stripped));
    } else {
        s.push_str(&String::from_utf8_lossy(name));
    }
    s.push('@');
    s.push_str(&String::from_utf8_lossy(version));
    s
}

/// Build the `subject` array for the in-toto statement.
pub fn subject(name: &[u8], version: &[u8], sha512_hex: &str) -> Value {
    json!([{
        "name": to_purl(name, version),
        "digest": { "sha512": sha512_hex },
    }])
}

/// Produce the in-toto statement JSON bytes for the given provider.
/// `subject` is the value returned by [`subject`].
pub fn generate(provider: CiProvider, subject: Value) -> Vec<u8> {
    let stmt = match provider {
        CiProvider::GithubActions => github_statement(subject),
        CiProvider::GitlabCi => gitlab_statement(subject),
    };
    serde_json::to_vec(&stmt).expect("provenance statement always serializes")
}

fn env(key: &bun_core::ZStr) -> String {
    match bun_core::getenv_z(key) {
        Some(v) => String::from_utf8_lossy(v).into_owned(),
        None => String::new(),
    }
}

macro_rules! e {
    ($name:literal) => {
        env(bun_core::zstr!($name))
    };
}

fn github_statement(subject: Value) -> Value {
    let repo = e!("GITHUB_REPOSITORY");
    let server = e!("GITHUB_SERVER_URL");
    let workflow_ref = e!("GITHUB_WORKFLOW_REF");

    // Strip `<owner>/<repo>/` prefix from GITHUB_WORKFLOW_REF and split on the
    // first `@` into (path, ref) — same as npm's `relativeRef.indexOf('@')`.
    let prefix = format!("{repo}/");
    let relative = workflow_ref.strip_prefix(&prefix).unwrap_or(&workflow_ref);
    let (workflow_path, workflow_git_ref) = match relative.find('@') {
        Some(i) => (&relative[..i], &relative[i + 1..]),
        None => (relative, ""),
    };

    json!({
        "_type": INTOTO_STATEMENT_V1_TYPE,
        "subject": subject,
        "predicateType": SLSA_PREDICATE_V1_TYPE,
        "predicate": {
            "buildDefinition": {
                "buildType": GITHUB_BUILD_TYPE,
                "externalParameters": {
                    "workflow": {
                        "ref": workflow_git_ref,
                        "repository": format!("{server}/{repo}"),
                        "path": workflow_path,
                    },
                },
                "internalParameters": {
                    "github": {
                        "event_name": e!("GITHUB_EVENT_NAME"),
                        "repository_id": e!("GITHUB_REPOSITORY_ID"),
                        "repository_owner_id": e!("GITHUB_REPOSITORY_OWNER_ID"),
                    },
                },
                "resolvedDependencies": [
                    {
                        "uri": format!("git+{server}/{repo}@{}", e!("GITHUB_REF")),
                        "digest": { "gitCommit": e!("GITHUB_SHA") },
                    }
                ],
            },
            "runDetails": {
                "builder": {
                    "id": format!("{GITHUB_BUILDER_ID_PREFIX}/{}", e!("RUNNER_ENVIRONMENT")),
                },
                "metadata": {
                    "invocationId": format!(
                        "{server}/{repo}/actions/runs/{}/attempts/{}",
                        e!("GITHUB_RUN_ID"),
                        e!("GITHUB_RUN_ATTEMPT"),
                    ),
                },
            },
        },
    })
}

fn gitlab_statement(subject: Value) -> Value {
    // npm threads a large fixed set of CI_* vars into `invocation.parameters`.
    // Keep this list in lockstep with `libnpmpublish/lib/provenance.js` — the
    // predicate is consumed by tooling that pattern-matches on these keys.
    macro_rules! ci_params {
        ($($k:literal),* $(,)?) => {
            json!({ $( $k: e!($k), )* })
        };
    }
    let parameters = ci_params![
        "CI",
        "CI_API_GRAPHQL_URL",
        "CI_API_V4_URL",
        "CI_BUILD_BEFORE_SHA",
        "CI_BUILD_ID",
        "CI_BUILD_NAME",
        "CI_BUILD_REF",
        "CI_BUILD_REF_NAME",
        "CI_BUILD_REF_SLUG",
        "CI_BUILD_STAGE",
        "CI_COMMIT_BEFORE_SHA",
        "CI_COMMIT_BRANCH",
        "CI_COMMIT_REF_NAME",
        "CI_COMMIT_REF_PROTECTED",
        "CI_COMMIT_REF_SLUG",
        "CI_COMMIT_SHA",
        "CI_COMMIT_SHORT_SHA",
        "CI_COMMIT_TIMESTAMP",
        "CI_COMMIT_TITLE",
        "CI_CONFIG_PATH",
        "CI_DEFAULT_BRANCH",
        "CI_DEPENDENCY_PROXY_DIRECT_GROUP_IMAGE_PREFIX",
        "CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX",
        "CI_DEPENDENCY_PROXY_SERVER",
        "CI_DEPENDENCY_PROXY_USER",
        "CI_JOB_ID",
        "CI_JOB_NAME",
        "CI_JOB_NAME_SLUG",
        "CI_JOB_STAGE",
        "CI_JOB_STARTED_AT",
        "CI_JOB_URL",
        "CI_NODE_TOTAL",
        "CI_PAGES_DOMAIN",
        "CI_PAGES_URL",
        "CI_PIPELINE_CREATED_AT",
        "CI_PIPELINE_ID",
        "CI_PIPELINE_IID",
        "CI_PIPELINE_SOURCE",
        "CI_PIPELINE_URL",
        "CI_PROJECT_CLASSIFICATION_LABEL",
        "CI_PROJECT_DESCRIPTION",
        "CI_PROJECT_ID",
        "CI_PROJECT_NAME",
        "CI_PROJECT_NAMESPACE",
        "CI_PROJECT_NAMESPACE_ID",
        "CI_PROJECT_PATH",
        "CI_PROJECT_PATH_SLUG",
        "CI_PROJECT_REPOSITORY_LANGUAGES",
        "CI_PROJECT_ROOT_NAMESPACE",
        "CI_PROJECT_TITLE",
        "CI_PROJECT_URL",
        "CI_PROJECT_VISIBILITY",
        "CI_REGISTRY",
        "CI_REGISTRY_IMAGE",
        "CI_REGISTRY_USER",
        "CI_RUNNER_DESCRIPTION",
        "CI_RUNNER_ID",
        "CI_RUNNER_TAGS",
        "CI_SERVER_HOST",
        "CI_SERVER_NAME",
        "CI_SERVER_PORT",
        "CI_SERVER_PROTOCOL",
        "CI_SERVER_REVISION",
        "CI_SERVER_SHELL_SSH_HOST",
        "CI_SERVER_SHELL_SSH_PORT",
        "CI_SERVER_URL",
        "CI_SERVER_VERSION",
        "CI_SERVER_VERSION_MAJOR",
        "CI_SERVER_VERSION_MINOR",
        "CI_SERVER_VERSION_PATCH",
        "CI_TEMPLATE_REGISTRY_HOST",
        "GITLAB_CI",
        "GITLAB_FEATURES",
        "GITLAB_USER_ID",
        "GITLAB_USER_LOGIN",
        "RUNNER_GENERATE_ARTIFACTS_METADATA",
    ];

    let project_url = e!("CI_PROJECT_URL");
    let commit_sha = e!("CI_COMMIT_SHA");

    json!({
        "_type": INTOTO_STATEMENT_V01_TYPE,
        "subject": subject,
        "predicateType": SLSA_PREDICATE_V02_TYPE,
        "predicate": {
            "buildType": format!("{GITLAB_BUILD_TYPE_PREFIX}/{GITLAB_BUILD_TYPE_VERSION}"),
            "builder": {
                "id": format!("{project_url}/-/runners/{}", e!("CI_RUNNER_ID")),
            },
            "invocation": {
                "configSource": {
                    "uri": format!("git+{project_url}"),
                    "digest": { "sha1": commit_sha },
                    "entryPoint": e!("CI_JOB_NAME"),
                },
                "parameters": parameters,
                "environment": {
                    "name": e!("CI_RUNNER_DESCRIPTION"),
                    "architecture": e!("CI_RUNNER_EXECUTABLE_ARCH"),
                    "server": e!("CI_SERVER_URL"),
                    "project": e!("CI_PROJECT_PATH"),
                    "job": { "id": e!("CI_JOB_ID") },
                    "pipeline": {
                        "id": e!("CI_PIPELINE_ID"),
                        "ref": e!("CI_CONFIG_PATH"),
                    },
                },
            },
            "metadata": {
                "buildInvocationId": e!("CI_JOB_URL"),
                "completeness": {
                    "parameters": true,
                    "environment": true,
                    "materials": false,
                },
                "reproducible": false,
            },
            "materials": [
                {
                    "uri": format!("git+{project_url}"),
                    "digest": { "sha1": commit_sha },
                }
            ],
        },
    })
}
