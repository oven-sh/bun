apk add --no-cache --no-interactive --no-progress docker docker-cli-compose
rc-update add docker default
addgroup "$AGENT_USER" docker
