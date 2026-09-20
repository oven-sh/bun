apk update
# PACKAGES is a list of names: splitting it is the point.
# shellcheck disable=SC2086
apk add --no-cache --no-interactive --no-progress $PACKAGES
