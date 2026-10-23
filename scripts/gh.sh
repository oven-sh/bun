#!/usr/bin/env bash
# Read-only gh wrapper for the issue and PR bots: a fixed set of subcommands and
# flags, always scoped to this repository.
set -euo pipefail

export GH_HOST=github.com

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
if [[ "$REPO" == */*/* || "$REPO" != */* ]]; then
  echo "Error: GITHUB_REPOSITORY must be owner/repo" >&2
  exit 1
fi
export GH_REPO="$REPO"

SUB1="${1:-}"
SUB2="${2:-}"
CMD="$SUB1 $SUB2"
case "$CMD" in
  "issue view" | "issue list" | "search issues" | "pr view" | "pr diff" | "search prs") ;;
  *)
    echo "Error: only issue view/list, pr view/diff and search issues/prs are allowed" >&2
    exit 1
    ;;
esac
shift 2

check_value() {
  local flag="$1" value="$2"
  case "$flag" in
    --state) [[ "$value" =~ ^(open|closed|all|merged)$ ]] ;;
    --limit) [[ "$value" =~ ^[1-9][0-9]{0,2}$ ]] ;;
    --label) [[ "$value" =~ ^[A-Za-z0-9\ ._-]{1,50}$ ]] ;;
  esac || {
    echo "Error: invalid value for $flag" >&2
    exit 1
  }
}

POSITIONAL=()
FLAGS=()
while [[ $# -gt 0 ]]; do
  arg="$1"
  shift
  case "$arg" in
    --comments) FLAGS+=("$arg") ;;
    --state | --limit | --label)
      if [[ $# -eq 0 ]]; then
        echo "Error: $arg needs a value" >&2
        exit 1
      fi
      check_value "$arg" "$1"
      FLAGS+=("$arg" "$1")
      shift
      ;;
    --state=* | --limit=* | --label=*)
      check_value "${arg%%=*}" "${arg#*=}"
      FLAGS+=("$arg")
      ;;
    -*)
      echo "Error: only --comments, --state, --limit and --label are allowed" >&2
      exit 1
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

case "$CMD" in
  "search issues" | "search prs")
    if [[ ${#POSITIONAL[@]} -ne 1 ]]; then
      echo "Error: search takes exactly one query" >&2
      exit 1
    fi
    query_lower=$(tr '[:upper:]' '[:lower:]' <<<"${POSITIONAL[0]}")
    if [[ "$query_lower" == *"repo:"* || "$query_lower" == *"org:"* || "$query_lower" == *"user:"* ]]; then
      echo "Error: search queries must not contain repo:, org: or user:" >&2
      exit 1
    fi
    exec gh search "$SUB2" "${POSITIONAL[0]}" --repo "$REPO" ${FLAGS[@]+"${FLAGS[@]}"}
    ;;
  "issue view" | "pr view" | "pr diff")
    if [[ ${#POSITIONAL[@]} -ne 1 ]] || ! [[ "${POSITIONAL[0]}" =~ ^[1-9][0-9]*$ ]]; then
      echo "Error: $CMD takes exactly one numeric number" >&2
      exit 1
    fi
    exec gh "$SUB1" "$SUB2" "${POSITIONAL[0]}" ${FLAGS[@]+"${FLAGS[@]}"}
    ;;
  *)
    if [[ ${#POSITIONAL[@]} -ne 0 ]]; then
      echo "Error: issue list takes no positional arguments" >&2
      exit 1
    fi
    exec gh issue list ${FLAGS[@]+"${FLAGS[@]}"}
    ;;
esac
