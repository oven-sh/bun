dir=$(mktemp -d)
download "$BUILDKITE_AGENT_URL" "$dir/agent.tar.gz"
tar -xzf "$dir/agent.tar.gz" -C "$dir" ./buildkite-agent
install -m 755 "$dir/buildkite-agent" /usr/local/bin/buildkite-agent
rm -rf "$dir"
