#!/usr/bin/env bash
# Posts the dedupe comment on the issue that triggered this run. The agent
# supplies issue numbers only; the wording, and the marker that
# auto-close-duplicates.ts looks for, are fixed here.
# Usage: ./scripts/comment-on-duplicates.sh --potential-duplicates 456 789 101
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

BASE_ISSUE=$(jq -r '.issue.number // .inputs.issue_number // empty' "${GITHUB_EVENT_PATH:?GITHUB_EVENT_PATH not set}")
if ! [[ "$BASE_ISSUE" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: no issue number in event payload" >&2
  exit 1
fi

# One comment per issue.
EXISTING=$(gh api --paginate "repos/$REPO/issues/$BASE_ISSUE/comments" --jq '.[].body')
if [[ "$EXISTING" == *"<!-- dedupe-bot:marker -->"* ]]; then
  echo "Error: this issue already has a dedupe comment" >&2
  exit 1
fi

if [[ "${1:-}" != "--potential-duplicates" ]]; then
  echo "Error: only --potential-duplicates is accepted" >&2
  exit 1
fi
shift

if [[ $# -eq 0 || $# -gt 3 ]]; then
  echo "Error: expected between 1 and 3 issue numbers" >&2
  exit 1
fi

for dup in "$@"; do
  if ! [[ "$dup" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: duplicate issue must be a number, got: $dup" >&2
    exit 1
  fi
  if [[ "$dup" == "$BASE_ISSUE" ]]; then
    echo "Error: an issue cannot duplicate itself" >&2
    exit 1
  fi
  TARGET=$(gh issue view "$dup" --repo "$REPO" --json state,url --jq '.state + " " + .url')
  if [[ "$TARGET" != "OPEN "*"/issues/$dup" ]]; then
    echo "Error: #$dup is not an open issue" >&2
    exit 1
  fi
done

if [[ $# -eq 1 ]]; then
  BODY="Found 1 possible duplicate issue:"$'\n\n'
else
  BODY="Found $# possible duplicate issues:"$'\n\n'
fi
INDEX=1
for dup in "$@"; do
  BODY+="$INDEX. https://github.com/$REPO/issues/$dup"$'\n'
  INDEX=$((INDEX + 1))
done
BODY+=$'\n'"This issue will be automatically closed as a duplicate in 3 days."$'\n\n'
BODY+="- If your issue is a duplicate, please close it and 👍 the existing issue instead"$'\n'
BODY+="- To prevent auto-closure, add a comment or 👎 this comment"$'\n\n'
BODY+="🤖 Generated with [Claude Code](https://claude.ai/code)"$'\n\n'
BODY+="<!-- dedupe-bot:marker -->"

gh issue comment "$BASE_ISSUE" --repo "$REPO" --body "$BODY"
