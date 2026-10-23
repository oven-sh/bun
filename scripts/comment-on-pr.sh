#!/usr/bin/env bash
# Posts a bot comment on the PR that triggered this run. The agent supplies
# numbers only; the wording and the marker are fixed here.
# Usage: ./scripts/comment-on-pr.sh --related-issues 123 456
#        ./scripts/comment-on-pr.sh --duplicate-prs 789
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
MAX_ITEMS=20

BASE_PR=$(jq -r '.pull_request.number // .inputs.pr_number // empty' "${GITHUB_EVENT_PATH:?GITHUB_EVENT_PATH not set}")
if ! [[ "$BASE_PR" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: no PR number in event payload" >&2
  exit 1
fi

# Set per workflow step.
MODE="${1:-}"
if [[ "$MODE" != "${COMMENT_MODE:?COMMENT_MODE not set}" ]]; then
  echo "Error: this step only accepts $COMMENT_MODE" >&2
  exit 1
fi
case "$MODE" in
  --related-issues) KIND=issue PATH_NAME=issues MARKER="<!-- find-issues-bot:marker -->" ;;
  --duplicate-prs) KIND=pr PATH_NAME=pull MARKER="<!-- find-duplicate-prs-bot:marker -->" ;;
  *)
    echo "Error: only --related-issues and --duplicate-prs are accepted" >&2
    exit 1
    ;;
esac
shift

EXISTING=$(gh api --paginate "repos/$REPO/issues/$BASE_PR/comments" --jq '.[].body')
if [[ "$EXISTING" == *"$MARKER"* ]]; then
  echo "Error: this PR already has this comment" >&2
  exit 1
fi

if [[ $# -eq 0 || $# -gt $MAX_ITEMS ]]; then
  echo "Error: expected between 1 and $MAX_ITEMS numbers" >&2
  exit 1
fi

for number in "$@"; do
  if ! [[ "$number" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: expected a number, got: $number" >&2
    exit 1
  fi
  if [[ "$number" == "$BASE_PR" ]]; then
    echo "Error: a PR cannot list itself" >&2
    exit 1
  fi
  TARGET=$(gh "$KIND" view "$number" --repo "$REPO" --json state,url --jq '.state + " " + .url')
  if [[ "$TARGET" != "OPEN "*"/$PATH_NAME/$number" ]]; then
    echo "Error: #$number is not open, or is the wrong kind" >&2
    exit 1
  fi
done

LIST=""
INDEX=1
for number in "$@"; do
  LIST+="$INDEX. https://github.com/$REPO/$PATH_NAME/$number"$'\n'
  INDEX=$((INDEX + 1))
done

FOOTER="🤖 Generated with [Claude Code](https://claude.ai/code)"
if [[ "$MODE" == "--related-issues" ]]; then
  if [[ $# -eq 1 ]]; then
    BODY="Found 1 issue this PR may fix:"$'\n\n'
  else
    BODY="Found $# issues this PR may fix:"$'\n\n'
  fi
  BODY+="$LIST"$'\n'
  BODY+="$FOOTER"$'\n\n'"$MARKER"
else
  BODY="This PR may be a duplicate of:"$'\n\n'
  BODY+="$LIST"$'\n'
  BODY+="$FOOTER"$'\n\n'"$MARKER"
fi

gh pr comment "$BASE_PR" --repo "$REPO" --body "$BODY"
