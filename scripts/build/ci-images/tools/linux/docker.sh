dir=$(mktemp -d)
download "$DOCKER_INSTALL_URL" "$dir/get-docker.sh"
sh "$dir/get-docker.sh"
rm -rf "$dir"
systemctl enable docker
usermod -aG docker "$AGENT_USER"

docker --version
