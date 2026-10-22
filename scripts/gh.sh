#!/usr/bin/env bash
# Read-only gh wrapper for the issue dedupe bot: a fixed set of subcommands and
# flags, always scoped to this repository.
set -euo pipefail

export GH_HOST=github.com

REPO="${GH_REPO:-${GITHUB_REPOSITORY:-}}"
if [[ -z "$REPO" || "$REPO" == */*/* || "$REPO" != */* ]]; then
  echo "Error: GH_REPO or GITHUB_REPOSITORY must be owner/repo" >&2
  exit 1
fi
export GH_REPO="$REPO"

ALLOWED_FLAGS=(--comments --state --limit --label)
FLAGS_WITH_VALUES=(--state --limit --label)

SUB1="${1:-}"
SUB2="${2:-}"
CMD="$SUB1 $SUB2"
case "$CMD" in
  "issue view" | "issue list" | "search issues") ;;
  *)
    echo "Error: only 'issue view', 'issue list' and 'search issues' are allowed" >&2
    exit 1
    ;;
esac
shift 2

POSITIONAL=()
FLAGS=()
skip_next=false
for arg in "$@"; do
  if [[ "$skip_next" == true ]]; then
    FLAGS+=("$arg")
    skip_next=false
  elif [[ "$arg" == -* ]]; then
    flag="${arg%%=*}"
    matched=false
    for allowed in "${ALLOWED_FLAGS[@]}"; do
      [[ "$flag" == "$allowed" ]] && matched=true
    done
    if [[ "$matched" == false ]]; then
      echo "Error: only --comments, --state, --limit and --label are allowed" >&2
      exit 1
    fi
    FLAGS+=("$arg")
    if [[ "$arg" != *=* ]]; then
      for value_flag in "${FLAGS_WITH_VALUES[@]}"; do
        [[ "$flag" == "$value_flag" ]] && skip_next=true
      done
    fi
  else
    POSITIONAL+=("$arg")
  fi
done

case "$CMD" in
  "search issues")
    if [[ ${#POSITIONAL[@]} -ne 1 ]]; then
      echo "Error: search issues takes exactly one query" >&2
      exit 1
    fi
    query_lower=$(tr '[:upper:]' '[:lower:]' <<<"${POSITIONAL[0]}")
    if [[ "$query_lower" == *"repo:"* || "$query_lower" == *"org:"* || "$query_lower" == *"user:"* ]]; then
      echo "Error: search queries must not contain repo:, org: or user:" >&2
      exit 1
    fi
    exec gh search issues "${POSITIONAL[0]}" --repo "$REPO" ${FLAGS[@]+"${FLAGS[@]}"}
    ;;
  "issue view")
    if [[ ${#POSITIONAL[@]} -ne 1 ]] || ! [[ "${POSITIONAL[0]}" =~ ^[0-9]+$ ]]; then
      echo "Error: issue view takes exactly one numeric issue number" >&2
      exit 1
    fi
    exec gh issue view "${POSITIONAL[0]}" ${FLAGS[@]+"${FLAGS[@]}"}
    ;;
  *)
    if [[ ${#POSITIONAL[@]} -ne 0 ]]; then
      echo "Error: issue list takes no positional arguments" >&2
      exit 1
    fi
    exec gh issue list ${FLAGS[@]+"${FLAGS[@]}"}
    ;;
esac
