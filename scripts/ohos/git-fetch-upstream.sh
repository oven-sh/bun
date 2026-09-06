#!/bin/bash
# 从上游 oven-sh/bun 获取最新代码并合并到当前分支
# 自动回退到 gh-proxy 当直连失败时
set -euo pipefail

UPSTREAM_REMOTE="${1:-origin}"
PROXY_REMOTE="ghproxy"

# 尝试直连
echo "→ 尝试直连 $UPSTREAM_REMOTE ..."
if git fetch "$UPSTREAM_REMOTE" main 2>/dev/null; then
    echo "✓ 直连成功"
    REMOTE="$UPSTREAM_REMOTE"
else
    echo "⚠ 直连失败，尝试代理 $PROXY_REMOTE ..."
    if git fetch "$PROXY_REMOTE" main 2>/dev/null; then
        echo "✓ 代理成功"
        REMOTE="$PROXY_REMOTE"
    else
        echo "✗ 代理也失败，网络不可达"
        exit 1
    fi
fi

# 检查新 commits
NEW_COMMITS=$(git log HEAD..FETCH_HEAD --oneline --no-decorate 2>/dev/null | wc -l)
if [ "$NEW_COMMITS" -eq 0 ]; then
    echo "✓ 已是最新，无需合并"
    exit 0
fi

echo "→ $NEW_COMMITS 个新 commits，尝试合并..."
if git merge FETCH_HEAD --no-commit 2>&1; then
    git merge --continue
    echo "✓ 合并完成"
else
    echo "✗ 合并冲突，请手动解决后 git merge --continue"
    exit 1
fi
