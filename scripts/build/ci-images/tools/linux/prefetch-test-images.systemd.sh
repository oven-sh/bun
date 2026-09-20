systemctl start docker
(cd "$REPO_DIR" && bun test/docker/prepare-ci.ts)
